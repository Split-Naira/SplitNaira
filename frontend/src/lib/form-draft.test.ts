import { describe, it, expect, beforeEach } from "vitest";
import {
  DRAFT_VERSION,
  DRAFT_TTL_MS,
  toSafeDraft,
  isEmptyDraft,
  draftStorageKey,
  saveDraft,
  loadDraft,
  clearDraft,
} from "./form-draft";

const FORM = "create";
const ACCOUNT = "GABC123";

describe("form-draft", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  describe("toSafeDraft", () => {
    it("projects only the allowlisted fields", () => {
      const draft = toSafeDraft({
        projectId: "p1",
        title: "My Project",
        projectType: "Music",
        token: "TOKEN",
        expiresAt: "2030-01-01T00:00:00.000Z",
        collaborators: [{ address: "ADDR", alias: "Alias", basisPoints: "5000" }],
        signature: "sig-should-be-dropped",
        transactionXdr: "AAAA-should-be-dropped",
      });

      expect(draft).toEqual({
        projectId: "p1",
        title: "My Project",
        projectType: "Music",
        token: "TOKEN",
        expiresAt: "2030-01-01T00:00:00.000Z",
        collaborators: [{ address: "ADDR", alias: "Alias", basisPoints: "5000" }],
      });
      expect(draft).not.toHaveProperty("signature");
      expect(draft).not.toHaveProperty("transactionXdr");
    });

    it("drops a value that looks like a Stellar secret seed", () => {
      const seed = "S" + "A".repeat(55);
      const draft = toSafeDraft({ projectId: seed, token: seed });
      expect(draft.projectId).toBe("");
      expect(draft.token).toBe("");
    });

    it("drops a collaborator address that looks like a secret seed", () => {
      const seed = "S" + "A".repeat(55);
      const draft = toSafeDraft({ collaborators: [{ address: seed, alias: "x", basisPoints: "1" }] });
      expect(draft.collaborators[0].address).toBe("");
    });

    it("drops values that exceed the field's length cap", () => {
      const draft = toSafeDraft({ projectId: "x".repeat(33), alias: "y" });
      expect(draft.projectId).toBe("");
    });

    it("keeps a value at exactly the length cap", () => {
      const draft = toSafeDraft({ projectId: "x".repeat(32) });
      expect(draft.projectId).toBe("x".repeat(32));
    });

    it("coerces non-string field values to empty strings", () => {
      const draft = toSafeDraft({ projectId: 123, title: null, token: { malicious: true } });
      expect(draft.projectId).toBe("");
      expect(draft.title).toBe("");
      expect(draft.token).toBe("");
    });

    it("caps collaborators at 50 rows", () => {
      const collaborators = Array.from({ length: 60 }, (_, i) => ({
        address: `addr-${i}`,
        alias: `alias-${i}`,
        basisPoints: "1",
      }));
      const draft = toSafeDraft({ collaborators });
      expect(draft.collaborators).toHaveLength(50);
    });

    it("tolerates non-object / missing input", () => {
      expect(toSafeDraft(null)).toEqual(toSafeDraft({}));
      expect(toSafeDraft(undefined)).toEqual(toSafeDraft({}));
      expect(toSafeDraft("not an object")).toEqual(toSafeDraft({}));
      expect(toSafeDraft({ collaborators: "not-an-array" }).collaborators).toEqual([]);
    });

    it("tolerates a non-object collaborator row", () => {
      const draft = toSafeDraft({ collaborators: ["not-an-object"] });
      expect(draft.collaborators).toEqual([{ address: "", alias: "", basisPoints: "" }]);
    });
  });

  describe("isEmptyDraft", () => {
    it("is true for an all-blank draft", () => {
      expect(isEmptyDraft(toSafeDraft({}))).toBe(true);
    });

    it("is false when any top-level field is set", () => {
      expect(isEmptyDraft(toSafeDraft({ projectId: "p1" }))).toBe(false);
    });

    it("is false when a collaborator has an address or alias", () => {
      expect(
        isEmptyDraft(toSafeDraft({ collaborators: [{ address: "ADDR", alias: "", basisPoints: "" }] })),
      ).toBe(false);
    });

    it("is true when collaborators only carry basisPoints with no address/alias", () => {
      expect(
        isEmptyDraft(toSafeDraft({ collaborators: [{ address: "", alias: "", basisPoints: "5000" }] })),
      ).toBe(true);
    });
  });

  describe("draftStorageKey", () => {
    it("scopes the key by form and uppercased account", () => {
      expect(draftStorageKey("create", "gabc")).toBe("splitnaira:draft:create:GABC");
    });

    it("falls back to an anonymous bucket when there is no account", () => {
      expect(draftStorageKey("create", null)).toBe("splitnaira:draft:create:anonymous");
    });
  });

  describe("save / load / clear round trip", () => {
    it("loads back exactly what was saved", () => {
      const values = { projectId: "p1", title: "Title", collaborators: [{ address: "A", alias: "B", basisPoints: "10000" }] };
      saveDraft(FORM, ACCOUNT, values);
      expect(loadDraft(FORM, ACCOUNT)).toEqual(toSafeDraft(values));
    });

    it("does not persist an empty draft", () => {
      saveDraft(FORM, ACCOUNT, {});
      expect(loadDraft(FORM, ACCOUNT)).toBeNull();
      expect(window.sessionStorage.getItem(draftStorageKey(FORM, ACCOUNT))).toBeNull();
    });

    it("removes a previously saved draft once the form is cleared out", () => {
      saveDraft(FORM, ACCOUNT, { projectId: "p1" });
      expect(loadDraft(FORM, ACCOUNT)).not.toBeNull();
      saveDraft(FORM, ACCOUNT, {});
      expect(loadDraft(FORM, ACCOUNT)).toBeNull();
    });

    it("scopes drafts per account so one account never sees another's draft", () => {
      saveDraft(FORM, "GACCOUNT1", { projectId: "p1" });
      expect(loadDraft(FORM, "GACCOUNT2")).toBeNull();
      expect(loadDraft(FORM, "GACCOUNT1")?.projectId).toBe("p1");
    });

    it("clearDraft removes the stored draft", () => {
      saveDraft(FORM, ACCOUNT, { projectId: "p1" });
      clearDraft(FORM, ACCOUNT);
      expect(loadDraft(FORM, ACCOUNT)).toBeNull();
    });

    it("rejects a draft whose schema version does not match", () => {
      const key = draftStorageKey(FORM, ACCOUNT);
      window.sessionStorage.setItem(
        key,
        JSON.stringify({ version: DRAFT_VERSION + 1, savedAt: Date.now(), values: { projectId: "p1" } }),
      );
      expect(loadDraft(FORM, ACCOUNT)).toBeNull();
      expect(window.sessionStorage.getItem(key)).toBeNull();
    });

    it("rejects an expired draft and clears it", () => {
      const key = draftStorageKey(FORM, ACCOUNT);
      const now = Date.now();
      window.sessionStorage.setItem(
        key,
        JSON.stringify({ version: DRAFT_VERSION, savedAt: now - DRAFT_TTL_MS - 1, values: { projectId: "p1" } }),
      );
      expect(loadDraft(FORM, ACCOUNT, now)).toBeNull();
      expect(window.sessionStorage.getItem(key)).toBeNull();
    });

    it("accepts a draft saved exactly at the TTL boundary", () => {
      const key = draftStorageKey(FORM, ACCOUNT);
      const now = Date.now();
      window.sessionStorage.setItem(
        key,
        JSON.stringify({ version: DRAFT_VERSION, savedAt: now - DRAFT_TTL_MS, values: { projectId: "p1" } }),
      );
      expect(loadDraft(FORM, ACCOUNT, now)?.projectId).toBe("p1");
    });

    it("rejects a draft timestamped in the future", () => {
      const key = draftStorageKey(FORM, ACCOUNT);
      const now = Date.now();
      window.sessionStorage.setItem(
        key,
        JSON.stringify({ version: DRAFT_VERSION, savedAt: now + 1000, values: { projectId: "p1" } }),
      );
      expect(loadDraft(FORM, ACCOUNT, now)).toBeNull();
    });

    it("discards malformed JSON instead of throwing", () => {
      const key = draftStorageKey(FORM, ACCOUNT);
      window.sessionStorage.setItem(key, "{not json");
      expect(() => loadDraft(FORM, ACCOUNT)).not.toThrow();
      expect(loadDraft(FORM, ACCOUNT)).toBeNull();
      expect(window.sessionStorage.getItem(key)).toBeNull();
    });

    it("strips secrets and transaction XDR out of a restored draft even if they were smuggled into storage", () => {
      const key = draftStorageKey(FORM, ACCOUNT);
      const seed = "S" + "A".repeat(55);
      window.sessionStorage.setItem(
        key,
        JSON.stringify({
          version: DRAFT_VERSION,
          savedAt: Date.now(),
          values: {
            projectId: "p1",
            token: seed,
            transactionXdr: "AAAA...",
            signature: "sig",
            collaborators: [{ address: seed, alias: "a", basisPoints: "1" }],
          },
        }),
      );
      const restored = loadDraft(FORM, ACCOUNT);
      expect(restored?.token).toBe("");
      expect(restored?.collaborators[0].address).toBe("");
      expect(restored).not.toHaveProperty("transactionXdr");
      expect(restored).not.toHaveProperty("signature");
    });

    it("never throws when sessionStorage is unavailable", () => {
      const original = window.sessionStorage.setItem;
      window.sessionStorage.setItem = () => {
        throw new Error("quota exceeded");
      };
      try {
        expect(() => saveDraft(FORM, ACCOUNT, { projectId: "p1" })).not.toThrow();
      } finally {
        window.sessionStorage.setItem = original;
      }
    });
  });
});
