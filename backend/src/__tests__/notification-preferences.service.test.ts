import { beforeEach, describe, expect, it, vi } from "vitest";

// Repository doubles, split by entity so the notifications store and the
// preferences store can be driven independently (#1327).
const findPreferencesMock = vi.fn();
const upsertPreferencesMock = vi.fn();
const createNotificationMock = vi.fn((input: unknown) => input);
const saveNotificationMock = vi.fn();

vi.mock("../services/database.js", () => ({
  getDataSource: () => ({
    getRepository: (entity: { name: string }) =>
      entity.name === "NotificationPreference"
        ? { find: findPreferencesMock, upsert: upsertPreferencesMock }
        : { create: createNotificationMock, save: saveNotificationMock },
  }),
}));

const {
  getPreferences,
  updatePreferences,
  shouldDeliver,
  MandatoryCategoryError,
  preferenceCategoryForNotification,
} = await import("../services/notification-preferences.service.js");
const { PREFERENCE_CATEGORIES } = await import(
  "../entities/NotificationPreference.js"
);
const { enqueueNotification } = await import(
  "../services/notifications.service.js"
);

const WALLET = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

function stored(category: string, enabled: boolean) {
  return { wallet: WALLET, category, enabled, updatedAt: new Date() };
}

beforeEach(() => {
  vi.clearAllMocks();
  findPreferencesMock.mockResolvedValue([]);
  upsertPreferencesMock.mockResolvedValue(undefined);
});

describe("getPreferences", () => {
  it("returns every category, defaulting untouched ones to enabled", async () => {
    findPreferencesMock.mockResolvedValue([stored("project_activity", false)]);

    const preferences = await getPreferences(WALLET);

    expect(preferences.map((p) => p.category)).toEqual([
      ...PREFERENCE_CATEGORIES,
    ]);
    expect(
      preferences.find((p) => p.category === "project_activity"),
    ).toMatchObject({ enabled: false, mandatory: false });
    expect(preferences.find((p) => p.category === "marketing")).toMatchObject({
      enabled: true,
      mandatory: false,
    });
  });

  it("keeps mandatory categories enabled even when a stale row says otherwise", async () => {
    // A row written before a category became mandatory must not be able to
    // suppress a security notice.
    findPreferencesMock.mockResolvedValue([
      stored("security", false),
      stored("payment", false),
    ]);

    const preferences = await getPreferences(WALLET);

    expect(preferences.find((p) => p.category === "security")).toMatchObject({
      enabled: true,
      mandatory: true,
    });
    expect(preferences.find((p) => p.category === "payment")).toMatchObject({
      enabled: true,
      mandatory: true,
    });
  });

  it("rejects an empty wallet rather than querying for every row", async () => {
    await expect(getPreferences("   ")).rejects.toThrow(/wallet/);
  });
});

describe("updatePreferences", () => {
  it("refuses to disable a mandatory category", async () => {
    await expect(
      updatePreferences(WALLET, [{ category: "security", enabled: false }]),
    ).rejects.toBeInstanceOf(MandatoryCategoryError);
    expect(upsertPreferencesMock).not.toHaveBeenCalled();
  });

  it("rejects the whole batch before writing anything", async () => {
    // The mandatory check runs over every update first: a batch must not be
    // half-applied because the offending entry arrived second.
    await expect(
      updatePreferences(WALLET, [
        { category: "marketing", enabled: false },
        { category: "payment", enabled: false },
      ]),
    ).rejects.toBeInstanceOf(MandatoryCategoryError);
    expect(upsertPreferencesMock).not.toHaveBeenCalled();
  });

  it("upserts optional categories on (wallet, category)", async () => {
    await updatePreferences(WALLET, [{ category: "marketing", enabled: false }]);

    expect(upsertPreferencesMock).toHaveBeenCalledTimes(1);
    expect(upsertPreferencesMock.mock.calls[0][1]).toEqual([
      "wallet",
      "category",
    ]);
  });

  it("returns the full resolved set after saving", async () => {
    findPreferencesMock.mockResolvedValue([stored("marketing", false)]);

    const result = await updatePreferences(WALLET, [
      { category: "marketing", enabled: false },
    ]);

    expect(result).toHaveLength(PREFERENCE_CATEGORIES.length);
    expect(result.find((p) => p.category === "marketing")?.enabled).toBe(false);
  });
});

describe("shouldDeliver", () => {
  it("always delivers mandatory categories without reading preferences", async () => {
    await expect(shouldDeliver(WALLET, "security")).resolves.toBe(true);
    expect(findPreferencesMock).not.toHaveBeenCalled();
  });

  it("honours an explicit opt-out", async () => {
    findPreferencesMock.mockResolvedValue([stored("marketing", false)]);
    await expect(shouldDeliver(WALLET, "marketing")).resolves.toBe(false);
  });

  it("delivers when the user has no stored preference", async () => {
    await expect(shouldDeliver(WALLET, "project_activity")).resolves.toBe(true);
  });
});

describe("preferenceCategoryForNotification", () => {
  it("maps delivery categories onto preference categories", () => {
    expect(preferenceCategoryForNotification("security")).toBe("security");
    expect(preferenceCategoryForNotification("payment")).toBe("payment");
    expect(preferenceCategoryForNotification("project")).toBe(
      "project_activity",
    );
    expect(preferenceCategoryForNotification("participant")).toBe(
      "participant_activity",
    );
  });

  it("leaves operational system notices unmapped so they always send", () => {
    expect(preferenceCategoryForNotification("system")).toBeNull();
  });
});

describe("enqueueNotification", () => {
  const input = {
    recipient: WALLET,
    category: "project" as const,
    title: "Split funded",
    body: "Your split received a deposit.",
    eventKey: "payment.settled:split:abc:-",
    source: "ledger",
  };

  it("suppresses a notification in an opted-out category", async () => {
    findPreferencesMock.mockResolvedValue([stored("project_activity", false)]);

    const result = await enqueueNotification(input);

    expect(result).toEqual({
      delivered: false,
      reason: "opted_out",
      preferenceCategory: "project_activity",
    });
    expect(saveNotificationMock).not.toHaveBeenCalled();
  });

  it("stores the notification when the category is enabled", async () => {
    saveNotificationMock.mockResolvedValue({ id: "n1", ...input });

    const result = await enqueueNotification(input);

    expect(result.delivered).toBe(true);
    expect(saveNotificationMock).toHaveBeenCalledTimes(1);
  });

  it("delivers a mandatory category even when a stale row disables it", async () => {
    findPreferencesMock.mockResolvedValue([stored("payment", false)]);
    saveNotificationMock.mockResolvedValue({ id: "n2", ...input });

    const result = await enqueueNotification({ ...input, category: "payment" });

    expect(result.delivered).toBe(true);
    expect(findPreferencesMock).not.toHaveBeenCalled();
  });
});
