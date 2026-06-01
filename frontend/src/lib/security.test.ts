/**
 * Security: Frontend Escaping Utilities Test Suite
 * Tests for HTML/XSS escaping functions
 */

import { describe, it, expect } from "vitest";
import {
  escapeHtml,
  sanitizeText,
  isSafeText,
  truncateText,
  formatUserText,
} from "./security";

describe("Security: Frontend Escaping Utilities", () => {
  describe("escapeHtml", () => {
    it("should escape HTML special characters", () => {
      const input = '<script>alert("XSS")</script>';
      const output = escapeHtml(input);
      expect(output).toBe("&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;");
      expect(output).not.toContain("<");
      expect(output).not.toContain(">");
    });

    it("should escape ampersands", () => {
      expect(escapeHtml("A & B")).toBe("A &amp; B");
    });

    it("should escape quotes", () => {
      expect(escapeHtml('test"quote')).toBe("test&quot;quote");
      expect(escapeHtml("test'quote")).toBe("test&#39;quote");
    });

    it("should handle multiple occurrences", () => {
      const input = "< > & \" '";
      const output = escapeHtml(input);
      expect(output).toBe("&lt; &gt; &amp; &quot; &#39;");
    });

    it("should preserve safe text", () => {
      const input = "Hello World 123!";
      expect(escapeHtml(input)).toBe("Hello World 123!");
    });
  });

  describe("sanitizeText", () => {
    it("should escape HTML and remove dangerous patterns", () => {
      const input = '<img src=x onerror="alert(1)">';
      const output = sanitizeText(input);
      expect(output).not.toContain("alert");
      expect(output).not.toContain("<");
    });

    it("should remove javascript: protocol", () => {
      const input = "javascript:alert(1)";
      const output = sanitizeText(input);
      expect(output).not.toContain("javascript:");
    });

    it("should remove vbscript: protocol", () => {
      const input = "vbscript:msgBox(1)";
      const output = sanitizeText(input);
      expect(output).not.toContain("vbscript:");
    });

    it("should remove event handler attributes", () => {
      const input = 'test onclick="alert(1)"';
      const output = sanitizeText(input);
      expect(output).not.toContain("onclick");
    });

    it("should remove eval calls", () => {
      const input = "test eval(123)";
      const output = sanitizeText(input);
      expect(output).not.toContain("eval(");
    });

    it("should preserve safe text", () => {
      const input = "My Project - Music & Art (2024)";
      const output = sanitizeText(input);
      expect(output).toContain("My Project");
      expect(output).toContain("Music");
      expect(output).toContain("Art");
    });
  });

  describe("isSafeText", () => {
    it("should return true for safe text", () => {
      expect(isSafeText("Hello World")).toBe(true);
      expect(isSafeText("Project-123")).toBe(true);
      expect(isSafeText("Art & Music")).toBe(true);
    });

    it("should return false for script tags", () => {
      expect(isSafeText("<script>alert(1)</script>")).toBe(false);
    });

    it("should return false for event handlers", () => {
      expect(isSafeText('test onclick="alert(1)"')).toBe(false);
      expect(isSafeText("test onerror=alert(1)")).toBe(false);
      expect(isSafeText("test onload=alert(1)")).toBe(false);
    });

    it("should return false for dangerous protocols", () => {
      expect(isSafeText("javascript:alert(1)")).toBe(false);
    });

    it("should return false for eval", () => {
      expect(isSafeText("eval(alert(1))")).toBe(false);
    });

    it("should be case-insensitive", () => {
      expect(isSafeText("ONCLICK=alert(1)")).toBe(false);
      expect(isSafeText("JavaScript:alert(1)")).toBe(false);
    });
  });

  describe("truncateText", () => {
    it("should not truncate text shorter than limit", () => {
      expect(truncateText("Hello", 10)).toBe("Hello");
    });

    it("should truncate text longer than limit", () => {
      const result = truncateText("Hello World Test", 8);
      expect(result.length).toBeLessThanOrEqual(8);
      expect(result).toContain("...");
    });

    it("should use custom suffix", () => {
      const result = truncateText("Hello World", 6, "→");
      expect(result).toContain("→");
    });

    it("should preserve word boundaries when possible", () => {
      const result = truncateText("Hello Beautiful World", 12);
      // Should truncate at word boundary (Hello Beautiful) not in middle
      expect(result).not.toContain("Beau");
    });

    it("should handle exact length match", () => {
      expect(truncateText("Hello", 5)).toBe("Hello");
      expect(truncateText("Hello", 4)).toContain("...");
    });
  });

  describe("formatUserText", () => {
    it("should escape and return safe text", () => {
      const input = '<script>alert("XSS")</script>';
      const output = formatUserText(input);
      expect(output).not.toContain("<script>");
      expect(output).not.toContain("alert");
    });

    it("should apply length limit if provided", () => {
      const input = "This is a very long text that should be truncated";
      const output = formatUserText(input, 10);
      expect(output.length).toBeLessThanOrEqual(13); // 10 + "..."
    });

    it("should handle both escaping and truncation", () => {
      const input = '<img src=x onerror="alert(1)"> and more text here';
      const output = formatUserText(input, 20);
      expect(output).not.toContain("alert");
      expect(output).not.toContain("<");
      expect(output.length).toBeLessThanOrEqual(23);
    });

    it("should preserve safe content with length limit", () => {
      const input = "My Music Project";
      const output = formatUserText(input, 20);
      expect(output).toBe("My Music Project");
    });
  });

  describe("Real-world XSS scenarios", () => {
    const xssScenarios = [
      {
        name: "SVG with event handler",
        input: '<svg onload="alert(1)">',
      },
      {
        name: "IMG with onerror",
        input: '<img src=x onerror="alert(1)">',
      },
      {
        name: "Iframe injection",
        input: '<iframe src="javascript:alert(1)">',
      },
      {
        name: "Form submission",
        input: '<form action="javascript:alert(1)">',
      },
      {
        name: "Style tag with expression",
        input: '<style>body{background:expression(alert(1))}</style>',
      },
      {
        name: "Data URI",
        input: 'data:text/html,<script>alert(1)</script>',
      },
      {
        name: "HTML5 event attributes",
        input: '<body onfocus="alert(1)" autofocus>',
      },
    ];

    xssScenarios.forEach(({ name, input }) => {
      it(`should safely handle: ${name}`, () => {
        const safe = isSafeText(input);
        expect(safe).toBe(false);

        const sanitized = sanitizeText(input);
        expect(sanitized).not.toContain("<");
        expect(sanitized).not.toContain(">");
        expect(sanitized).not.toContain("javascript:");
      });
    });
  });
});
