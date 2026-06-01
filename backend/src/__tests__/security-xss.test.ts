/**
 * Security: XSS Prevention Test Suite
 * Tests for script injection and HTML escaping vulnerabilities
 * Related to: GitHub Issue #292 - XSS in Split Description Field
 */

import { describe, it, expect } from "vitest";
import {
  createSplitSchema,
  updateMetadataSchema,
  collaboratorSchema,
} from "../schemas/splits.js";

describe("Security: XSS Prevention", () => {
  describe("Title field validation", () => {
    it("should reject script tags in title", () => {
      const maliciousTitle = "<script>alert('XSS')</script>";
      const result = createSplitSchema.safeParse({
        owner: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
        projectId: "test_project",
        title: maliciousTitle,
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
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes("title"))).toBe(
          true
        );
      }
    });

    it("should reject onclick handlers in title", () => {
      const maliciousTitle = 'test onclick="alert(1)"';
      const result = createSplitSchema.safeParse({
        owner: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
        projectId: "test_project",
        title: maliciousTitle,
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
      expect(result.success).toBe(false);
    });

    it("should reject javascript: protocol in title", () => {
      const maliciousTitle = "javascript:alert(1)";
      const result = createSplitSchema.safeParse({
        owner: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
        projectId: "test_project",
        title: maliciousTitle,
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
      expect(result.success).toBe(false);
    });

    it("should reject eval() in title", () => {
      const maliciousTitle = "test eval(123)";
      const result = createSplitSchema.safeParse({
        owner: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
        projectId: "test_project",
        title: maliciousTitle,
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
      expect(result.success).toBe(false);
    });

    it("should accept safe titles with spaces and punctuation", () => {
      const safeTitle = "My Awesome Music Project - Featuring Top Artists";
      const result = createSplitSchema.safeParse({
        owner: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
        projectId: "test_project",
        title: safeTitle,
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
      expect(result.success).toBe(true);
    });

    it("should accept alphanumeric titles", () => {
      const safeTitle = "Project123";
      const result = createSplitSchema.safeParse({
        owner: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
        projectId: "test_project",
        title: safeTitle,
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
      expect(result.success).toBe(true);
    });
  });

  describe("ProjectType field validation", () => {
    it("should reject HTML tags in projectType", () => {
      const maliciousType = "<img src=x onerror=alert(1)>";
      const result = updateMetadataSchema.safeParse({
        owner: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
        title: "Safe Title",
        projectType: maliciousType,
      });
      expect(result.success).toBe(false);
    });

    it("should reject data: URI in projectType", () => {
      const maliciousType = "data:text/html,<script>alert(1)</script>";
      const result = updateMetadataSchema.safeParse({
        owner: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
        title: "Safe Title",
        projectType: maliciousType,
      });
      expect(result.success).toBe(false);
    });

    it("should accept valid projectType values", () => {
      const validTypes = ["music", "film", "art", "music-video", "podcast"];
      for (const validType of validTypes) {
        const result = updateMetadataSchema.safeParse({
          owner: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
          title: "Safe Title",
          projectType: validType,
        });
        expect(result.success).toBe(true, `Failed for ${validType}`);
      }
    });
  });

  describe("Alias field validation (collaborators)", () => {
    it("should reject script tags in collaborator alias", () => {
      const result = collaboratorSchema.safeParse({
        address: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
        alias: "<script>alert(1)</script>",
        basisPoints: 5000,
      });
      expect(result.success).toBe(false);
    });

    it("should reject onerror handlers in alias", () => {
      const result = collaboratorSchema.safeParse({
        address: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
        alias: "test onerror=alert(1)",
        basisPoints: 5000,
      });
      expect(result.success).toBe(false);
    });

    it("should accept safe collaborator aliases with spaces", () => {
      const result = collaboratorSchema.safeParse({
        address: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
        alias: "John Smith - Producer",
        basisPoints: 5000,
      });
      expect(result.success).toBe(true);
    });

    it("should accept alphanumeric aliases", () => {
      const result = collaboratorSchema.safeParse({
        address: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
        alias: "Artist123",
        basisPoints: 5000,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Common XSS vectors", () => {
    const basePayload = {
      owner: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
      projectId: "test_project",
      title: "Test",
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
    };

    const xssVectors = [
      { name: "SVG event handler", payload: "<svg onload=alert(1)>" },
      { name: "IMG tag with onerror", payload: "<img src=x onerror=alert(1)>" },
      { name: "Form action redirect", payload: '<form action="javascript:alert(1)">' },
      { name: "Iframe injection", payload: '<iframe src="javascript:alert(1)">' },
      { name: "Event handler attribute", payload: 'test onmouseover="alert(1)"' },
      { name: "CSS expression", payload: 'test expression(alert(1))' },
      { name: "VBScript protocol", payload: "vbscript:alert(1)" },
      { name: "Base64 encoding", payload: "javascript:eval(atob(...))" },
    ];

    xssVectors.forEach(({ name, payload }) => {
      it(`should reject ${name} in title`, () => {
        const result = createSplitSchema.safeParse({
          ...basePayload,
          title: payload,
        });
        expect(result.success).toBe(
          false,
          `${name} should be rejected but was accepted`
        );
      });

      it(`should reject ${name} in projectType`, () => {
        const result = createSplitSchema.safeParse({
          ...basePayload,
          projectType: payload,
        });
        expect(result.success).toBe(
          false,
          `${name} should be rejected in projectType but was accepted`
        );
      });
    });
  });

  describe("Character limits", () => {
    it("should enforce maximum title length (128 chars)", () => {
      const tooLongTitle = "a".repeat(129);
      const result = createSplitSchema.safeParse({
        owner: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
        projectId: "test_project",
        title: tooLongTitle,
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
      expect(result.success).toBe(false);
    });

    it("should enforce maximum projectType length (32 chars)", () => {
      const tooLongType = "a".repeat(33);
      const result = updateMetadataSchema.safeParse({
        owner: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
        title: "Safe Title",
        projectType: tooLongType,
      });
      expect(result.success).toBe(false);
    });

    it("should enforce maximum alias length (100 chars)", () => {
      const tooLongAlias = "a".repeat(101);
      const result = collaboratorSchema.safeParse({
        address: "GBRPYHIL2CI3WHPSKYNYFRM5MH72RTZGKSW2ZSOB2BBZKJFMV7NZUKX",
        alias: tooLongAlias,
        basisPoints: 5000,
      });
      expect(result.success).toBe(false);
    });
  });
});
