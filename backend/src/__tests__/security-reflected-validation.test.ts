/**
 * Security: Reflected Validation Error Content Tests
 * Tests that validation error responses do not reflect malicious user input
 * that could enable XSS or content injection attacks.
 *
 * Related to: SplitNaira security hardening — reflected validation error content
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../index.js";

vi.mock("@stellar/stellar-sdk", () => ({
  Address: {
    fromString: vi.fn(() => ({})),
  },
}));

vi.mock("../services/stellar.js", async () => {
  const actual = await vi.importActual<typeof import("../services/stellar.js")>("../services/stellar.js");
  return {
    ...actual,
    getStellarRpcServer: vi.fn(),
    loadStellarConfig: vi.fn(),
    executeWithRetry: vi.fn(async (fn) => fn()),
  };
});

vi.mock("../services/database.js", async () => {
  const actual = await vi.importActual<typeof import("../services/database.js")>("../services/database.js");
  return {
    ...actual,
    getDataSource: vi.fn(),
  };
});

describe("Security: Reflected Validation Error Content", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  describe("XSS payloads must not appear verbatim in error responses", () => {
    const xssPayloads = [
      { name: "script tag", payload: "<script>alert(1)</script>" },
      { name: "img onerror", payload: '<img src=x onerror=alert(1)>' },
      { name: "svg onload", payload: '<svg onload=alert(1)>' },
      { name: "javascript protocol", payload: "javascript:alert(1)" },
      { name: "onclick handler", payload: 'test onclick="alert(1)"' },
      { name: "iframe injection", payload: '<iframe src="javascript:alert(1)">' },
      { name: "data URI", payload: "data:text/html,<script>alert(1)</script>" },
      { name: "eval expression", payload: "test eval(alert(1))" },
    ];

    xssPayloads.forEach(({ name, payload }) => {
      it(`must not reflect ${name} in error response body`, async () => {
        const response = await request(app)
          .post("/splits")
          .send({
            owner: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
            projectId: "test_project",
            title: payload,
            projectType: "music",
            token: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
            collaborators: [
              {
                address: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
                alias: "Collaborator 1",
                basisPoints: 5000,
              },
              {
                address: "GC4T3X2BFXDFJZ7TZHQ2U4BLQZFNV3KVEYAQN37HQNGXZKAHXCN5KFS7",
                alias: "Collaborator 2",
                basisPoints: 5000,
              },
            ],
          });

        expect(response.status).toBe(400);
        const responseBody = JSON.stringify(response.body);

        expect(responseBody).not.toContain(payload);
      });

      it(`must not reflect ${name} in error response details`, async () => {
        const response = await request(app)
          .post("/splits")
          .send({
            owner: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
            projectId: "test_project",
            title: "Valid Title",
            projectType: payload,
            token: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
            collaborators: [
              {
                address: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
                alias: "Collaborator 1",
                basisPoints: 5000,
              },
              {
                address: "GC4T3X2BFXDFJZ7TZHQ2U4BLQZFNV3KVEYAQN37HQNGXZKAHXCN5KFS7",
                alias: "Collaborator 2",
                basisPoints: 5000,
              },
            ],
          });

        expect(response.status).toBe(400);
        const responseBody = JSON.stringify(response.body);

        expect(responseBody).not.toContain(payload);
      });
    });
  });

  describe("HTML tags must not appear in error response details", () => {
    it("must strip HTML tags from validation error messages", async () => {
      const maliciousInput = '<b>bold</b><i>italic</i>';
      const response = await request(app)
        .post("/splits")
        .send({
          owner: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
          projectId: "test_project",
          title: maliciousInput,
          projectType: "music",
          token: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
          collaborators: [
            {
              address: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
              alias: "Collaborator 1",
              basisPoints: 5000,
            },
            {
              address: "GC4T3X2BFXDFJZ7TZHQ2U4BLQZFNV3KVEYAQN37HQNGXZKAHXCN5KFS7",
              alias: "Collaborator 2",
              basisPoints: 5000,
            },
          ],
        });

      expect(response.status).toBe(400);
      const responseBody = JSON.stringify(response.body);

      expect(responseBody).not.toMatch(/<[^>]*>/);
    });

    it("must not reflect event handler attributes in error messages", async () => {
      const maliciousInput = 'onmouseover="alert(1)"';
      const response = await request(app)
        .post("/splits")
        .send({
          owner: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
          projectId: "test_project",
          title: maliciousInput,
          projectType: "music",
          token: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
          collaborators: [
            {
              address: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
              alias: "Collaborator 1",
              basisPoints: 5000,
            },
            {
              address: "GC4T3X2BFXDFJZ7TZHQ2U4BLQZFNV3KVEYAQN37HQNGXZKAHXCN5KFS7",
              alias: "Collaborator 2",
              basisPoints: 5000,
            },
          ],
        });

      expect(response.status).toBe(400);
      const responseBody = JSON.stringify(response.body);

      expect(responseBody).not.toContain("onmouseover");
      expect(responseBody).not.toContain("alert(1)");
    });
  });

  describe("Error response structure safety", () => {
    it("must return safe error codes, not raw user input", async () => {
      const response = await request(app)
        .post("/splits")
        .send({
          owner: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
          projectId: "<script>alert(1)</script>",
          title: "Valid Title",
          projectType: "music",
          token: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
          collaborators: [
            {
              address: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
              alias: "Collaborator 1",
              basisPoints: 5000,
            },
            {
              address: "GC4T3X2BFXDFJZ7TZHQ2U4BLQZFNV3KVEYAQN37HQNGXZKAHXCN5KFS7",
              alias: "Collaborator 2",
              basisPoints: 5000,
            },
          ],
        });

      expect(response.status).toBe(400);

      if (response.body.details) {
        const detailsStr = JSON.stringify(response.body.details);
        expect(detailsStr).not.toContain("<script>");
        expect(detailsStr).not.toContain("alert(1)");
      }
    });

    it("must not include raw input in error message field", async () => {
      const maliciousProjectId = "<img src=x onerror=alert(1)>";
      const response = await request(app)
        .post("/splits")
        .send({
          owner: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
          projectId: maliciousProjectId,
          title: "Valid Title",
          projectType: "music",
          token: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
          collaborators: [
            {
              address: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
              alias: "Collaborator 1",
              basisPoints: 5000,
            },
            {
              address: "GC4T3X2BFXDFJZ7TZHQ2U4BLQZFNV3KVEYAQN37HQNGXZKAHXCN5KFS7",
              alias: "Collaborator 2",
              basisPoints: 5000,
            },
          ],
        });

      expect(response.status).toBe(400);
      expect(response.body.message).not.toContain(maliciousProjectId);
      expect(response.body.message).not.toContain("<img");
    });
  });

  describe("Collaborator alias validation error safety", () => {
    it("must not reflect XSS payloads from collaborator aliases", async () => {
      const xssAlias = "<script>document.location='https://evil.com'</script>";
      const response = await request(app)
        .post("/splits")
        .send({
          owner: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
          projectId: "test_project",
          title: "Valid Title",
          projectType: "music",
          token: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
          collaborators: [
            {
              address: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
              alias: xssAlias,
              basisPoints: 5000,
            },
            {
              address: "GC4T3X2BFXDFJZ7TZHQ2U4BLQZFNV3KVEYAQN37HQNGXZKAHXCN5KFS7",
              alias: "Collaborator 2",
              basisPoints: 5000,
            },
          ],
        });

      expect(response.status).toBe(400);
      const responseBody = JSON.stringify(response.body);

      expect(responseBody).not.toContain(xssAlias);
      expect(responseBody).not.toContain("<script>");
      expect(responseBody).not.toContain("document.location");
      expect(responseBody).not.toContain("evil.com");
    });
  });

  describe("Error response headers safety", () => {
    it("must include X-Content-Type-Options header in error responses", async () => {
      const response = await request(app)
        .post("/splits")
        .send({
          owner: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
          projectId: "<script>alert(1)</script>",
          title: "Valid Title",
          projectType: "music",
          token: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
          collaborators: [
            {
              address: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
              alias: "Collaborator 1",
              basisPoints: 5000,
            },
            {
              address: "GC4T3X2BFXDFJZ7TZHQ2U4BLQZFNV3KVEYAQN37HQNGXZKAHXCN5KFS7",
              alias: "Collaborator 2",
              basisPoints: 5000,
            },
          ],
        });

      expect(response.status).toBe(400);
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
    });

    it("must set correct Content-Type for JSON error responses", async () => {
      const response = await request(app)
        .post("/splits")
        .send({
          owner: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
          projectId: "<script>alert(1)</script>",
          title: "Valid Title",
          projectType: "music",
          token: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
          collaborators: [
            {
              address: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
              alias: "Collaborator 1",
              basisPoints: 5000,
            },
            {
              address: "GC4T3X2BFXDFJZ7TZHQ2U4BLQZFNV3KVEYAQN37HQNGXZKAHXCN5KFS7",
              alias: "Collaborator 2",
              basisPoints: 5000,
            },
          ],
        });

      expect(response.status).toBe(400);
      expect(response.headers["content-type"]).toMatch(/application\/json/);
    });
  });

  describe("Path and query parameter validation error safety", () => {
    it("must not reflect malicious path parameters in error responses", async () => {
      const maliciousProjectId = "<script>alert(1)</script>";
      const response = await request(app)
        .get(`/splits/${encodeURIComponent(maliciousProjectId)}`);

      expect([400, 404]).toContain(response.status);
      const responseBody = JSON.stringify(response.body);

      expect(responseBody).not.toContain("<script>");
      expect(responseBody).not.toContain("alert(1)");
    });

    it("must not reflect malicious query parameters in error responses", async () => {
      const response = await request(app)
        .get("/splits")
        .query({ search: "<script>alert(1)</script>" });

      const responseBody = JSON.stringify(response.body);

      expect(responseBody).not.toContain("<script>");
      expect(responseBody).not.toContain("alert(1)");
    });
  });
});
