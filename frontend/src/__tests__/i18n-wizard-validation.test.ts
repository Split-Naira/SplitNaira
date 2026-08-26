/* @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import enMessages from "../../messages/en.json";
import frMessages from "../../messages/fr.json";
import { REQUIRED_WIZARD_VALIDATION_KEYS, flattenEntries, extractPlaceholders } from "../../scripts/check-i18n-keys.mjs";

describe("Split wizard validation i18n resources", () => {
  it("includes all required wizard validation keys in en.json", () => {
    const enEntries = flattenEntries(enMessages);
    for (const key of REQUIRED_WIZARD_VALIDATION_KEYS) {
      expect(enEntries[key], `Missing key in en.json: ${key}`).toBeDefined();
      expect(typeof enEntries[key]).toBe("string");
      expect(enEntries[key].trim().length).toBeGreaterThan(0);
    }
  });

  it("includes all required wizard validation keys in fr.json with valid French translations", () => {
    const frEntries = flattenEntries(frMessages);
    for (const key of REQUIRED_WIZARD_VALIDATION_KEYS) {
      expect(frEntries[key], `Missing key in fr.json: ${key}`).toBeDefined();
      expect(typeof frEntries[key]).toBe("string");
      expect(frEntries[key].trim().length).toBeGreaterThan(0);
    }
  });

  it("matches interpolation placeholders between en.json and fr.json for wizard messages", () => {
    const enEntries = flattenEntries(enMessages);
    const frEntries = flattenEntries(frMessages);

    for (const key of REQUIRED_WIZARD_VALIDATION_KEYS) {
      const enPlaceholders = extractPlaceholders(enEntries[key]);
      const frPlaceholders = extractPlaceholders(frEntries[key]);
      expect(
        frPlaceholders,
        `Placeholder mismatch for ${key}: en=${JSON.stringify(enPlaceholders)}, fr=${JSON.stringify(frPlaceholders)}`
      ).toEqual(enPlaceholders);
    }
  });

  it("has distinct localized text in French vs English", () => {
    const enEntries = flattenEntries(enMessages);
    const frEntries = flattenEntries(frMessages);

    // Verify key validation messages are actually translated and not identical to English
    expect(frEntries["SplitApp.wizard.validation.projectIdRequired"]).not.toBe(
      enEntries["SplitApp.wizard.validation.projectIdRequired"]
    );
    expect(frEntries["SplitApp.wizard.validation.titleRequired"]).not.toBe(
      enEntries["SplitApp.wizard.validation.titleRequired"]
    );
    expect(frEntries["SplitApp.wizard.validation.tokenRequired"]).not.toBe(
      enEntries["SplitApp.wizard.validation.tokenRequired"]
    );
    expect(frEntries["SplitApp.wizard.validation.sharesValid"]).not.toBe(
      enEntries["SplitApp.wizard.validation.sharesValid"]
    );
  });
});
