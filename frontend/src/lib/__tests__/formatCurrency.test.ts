import { describe, expect, it } from 'vitest';

import {
  ASSET_CODES,
  FIAT_CURRENCIES,
  STROOPS_PER_UNIT,
  formatAsset,
  formatCurrency,
  formatStroops,
} from '../formatCurrency';

/**
 * Normalises characters whose exact code point is not stable across ICU
 * versions.
 *
 * French grouping uses U+202F (narrow no-break space) on current ICU and
 * U+00A0 on older builds, and some locales use U+2212 MINUS SIGN rather than
 * ASCII hyphen. Asserting on raw output makes this suite fail on an ICU
 * upgrade for reasons unrelated to the code under test.
 */
function normalise(value: string): string {
  return value.replace(/[\u00A0\u202F]/g, ' ').replace(/\u2212/g, '-');
}

describe('formatCurrency', () => {
  describe('supported fiat currencies', () => {
    it('formats naira with the naira sign for en-NG', () => {
      expect(normalise(formatCurrency(1234.56, 'en-NG', 'NGN'))).toBe(
        '₦1,234.56',
      );
    });

    it('falls back to the ISO code outside Nigeria rather than mislabelling it', () => {
      expect(normalise(formatCurrency(1234.56, 'en', 'NGN'))).toBe(
        'NGN 1,234.56',
      );
    });

    it('formats dollars for en-US', () => {
      expect(normalise(formatCurrency(1234.56, 'en-US', 'USD'))).toBe(
        '$1,234.56',
      );
    });

    it('formats euros for de', () => {
      expect(normalise(formatCurrency(1234.56, 'de', 'EUR'))).toBe(
        '1.234,56 €',
      );
    });

    it('exposes only the currencies it supports', () => {
      expect(FIAT_CURRENCIES).toEqual(['NGN', 'USD', 'EUR']);
    });
  });

  describe('locale awareness', () => {
    it('places the group separator per locale', () => {
      expect(formatCurrency(1234.56, 'en', 'USD')).toContain('1,234.56');
      expect(formatCurrency(1234.56, 'de', 'USD')).toContain('1.234,56');
    });

    it('places the decimal separator per locale', () => {
      expect(formatCurrency(1234.56, 'en', 'USD')).toContain('1,234.56');
      expect(normalise(formatCurrency(1234.56, 'fr', 'USD'))).toContain(
        '1 234,56',
      );
    });

    it('keeps the same digits across locales', () => {
      const digits = (locale: string) =>
        normalise(formatCurrency(1234.56, locale, 'USD')).replace(/\D/g, '');

      expect(digits('en')).toBe('123456');
      expect(digits('fr')).toBe('123456');
      expect(digits('de')).toBe('123456');
      expect(digits('ja')).toBe('123456');
    });
  });

  describe('negative amounts', () => {
    it('keeps the sign for negative naira', () => {
      expect(normalise(formatCurrency(-50, 'en-NG', 'NGN'))).toBe('-₦50.00');
    });

    it('keeps the sign for negative dollars', () => {
      expect(normalise(formatCurrency(-50, 'en-US', 'USD'))).toBe('-$50.00');
    });

    it('keeps the sign in locales that place the currency last', () => {
      expect(normalise(formatCurrency(-50, 'de', 'EUR'))).toBe('-50,00 €');
    });

    it('does not turn a negative into a positive when zero is passed', () => {
      expect(formatCurrency(0, 'en', 'USD')).not.toContain('-');
    });
  });

  describe('boundary values', () => {
    it('formats zero', () => {
      expect(normalise(formatCurrency(0, 'en-NG', 'NGN'))).toBe('₦0.00');
    });

    it('formats one kobo, the smallest naira unit in circulation', () => {
      expect(normalise(formatCurrency(0.01, 'en-NG', 'NGN'))).toBe('₦0.01');
    });

    it('rounds a sub-kobo amount up rather than dropping it', () => {
      expect(normalise(formatCurrency(0.005, 'en-NG', 'NGN'))).toBe('₦0.01');
    });

    it('formats very large amounts without losing digits', () => {
      expect(normalise(formatCurrency(1234567890123.45, 'en-NG', 'NGN'))).toBe(
        '₦1,234,567,890,123.45',
      );
    });

    it('formats the largest safe integer', () => {
      expect(normalise(formatCurrency(Number.MAX_SAFE_INTEGER, 'en', 'USD'))).toBe(
        '$9,007,199,254,740,991.00',
      );
    });
  });

  describe('rejects values it cannot format honestly', () => {
    it('throws on NaN rather than rendering "NaN"', () => {
      expect(() => formatCurrency(NaN, 'en', 'USD')).toThrow(RangeError);
    });

    it('throws on Infinity', () => {
      expect(() => formatCurrency(Infinity, 'en', 'USD')).toThrow(RangeError);
    });

    it('throws on -Infinity', () => {
      expect(() => formatCurrency(-Infinity, 'en', 'USD')).toThrow(RangeError);
    });

    it('throws when the amount is not a number', () => {
      expect(() =>
        formatCurrency('10' as unknown as number, 'en', 'USD'),
      ).toThrow(TypeError);
    });

    it('throws when the amount is null', () => {
      expect(() =>
        formatCurrency(null as unknown as number, 'en', 'USD'),
      ).toThrow(TypeError);
    });

    it('throws on an unsupported currency instead of guessing', () => {
      expect(() =>
        formatCurrency(10, 'en', 'GBP' as unknown as 'USD'),
      ).toThrow(RangeError);
    });

    it('throws on a structurally invalid locale', () => {
      expect(() => formatCurrency(10, 'not a locale', 'USD')).toThrow(
        RangeError,
      );
    });

    it('throws on an empty locale rather than defaulting silently', () => {
      expect(() => formatCurrency(10, '', 'USD')).toThrow(TypeError);
    });

    it('throws when the locale is not a string', () => {
      expect(() =>
        formatCurrency(10, 42 as unknown as string, 'USD'),
      ).toThrow(TypeError);
    });

    it('names the offending value so the fault is findable', () => {
      expect(() => formatCurrency(10, 'en', 'GBP' as unknown as 'USD')).toThrow(
        /GBP/,
      );
    });
  });
});

describe('formatAsset', () => {
  it('formats a whole XLM amount without padding to seven digits', () => {
    expect(normalise(formatAsset(1, 'en', 'XLM'))).toBe('1 XLM');
  });

  it('keeps full XLM precision for a fractional amount', () => {
    expect(normalise(formatAsset(1234.5678, 'en', 'XLM'))).toBe(
      '1,234.5678 XLM',
    );
  });

  it('formats USDC with cents', () => {
    expect(normalise(formatAsset(25, 'en', 'USDC'))).toBe('25.00 USDC');
  });

  it('formats EURC with cents', () => {
    expect(normalise(formatAsset(0.01, 'en', 'EURC'))).toBe('0.01 EURC');
  });

  it('appends the asset code', () => {
    expect(formatAsset(1, 'en', 'XLM')).toMatch(/ XLM$/);
  });

  it('groups per locale', () => {
    expect(normalise(formatAsset(1234.5678, 'de', 'XLM'))).toBe(
      '1.234,5678 XLM',
    );
  });

  it('keeps the sign for a negative asset amount', () => {
    expect(normalise(formatAsset(-25.5, 'fr', 'XLM'))).toBe('-25,5 XLM');
  });

  it('formats zero', () => {
    expect(normalise(formatAsset(0, 'en', 'XLM'))).toBe('0 XLM');
  });

  it('exposes only the assets it supports', () => {
    expect(ASSET_CODES).toEqual(['XLM', 'USDC', 'EURC']);
  });

  it('rejects an unsupported asset code', () => {
    expect(() => formatAsset(1, 'en', 'DOGE' as unknown as 'XLM')).toThrow(
      RangeError,
    );
  });

  it('rejects NaN', () => {
    expect(() => formatAsset(NaN, 'en', 'XLM')).toThrow(RangeError);
  });
});

describe('formatStroops', () => {
  it('converts one whole unit', () => {
    expect(normalise(formatStroops(STROOPS_PER_UNIT, 'en', 'XLM'))).toBe(
      '1 XLM',
    );
  });

  it('renders a single stroop instead of collapsing it to zero', () => {
    expect(normalise(formatStroops(1, 'en', 'XLM'))).toBe('0.0000001 XLM');
  });

  it('keeps the sign for negative stroops', () => {
    expect(normalise(formatStroops(-STROOPS_PER_UNIT, 'en', 'XLM'))).toBe(
      '-1 XLM',
    );
  });

  it('formats zero stroops', () => {
    expect(normalise(formatStroops(0, 'en', 'XLM'))).toBe('0 XLM');
  });

  it('formats many units', () => {
    expect(normalise(formatStroops(3 * STROOPS_PER_UNIT, 'en', 'XLM'))).toBe(
      '3 XLM',
    );
  });

  it('is locale-aware', () => {
    expect(normalise(formatStroops(1234 * STROOPS_PER_UNIT, 'de', 'XLM'))).toBe(
      '1.234 XLM',
    );
  });

  it('rejects NaN', () => {
    expect(() => formatStroops(NaN, 'en', 'XLM')).toThrow(RangeError);
  });

  it('rejects an unsupported asset code', () => {
    expect(() => formatStroops(1, 'en', 'BTC' as unknown as 'XLM')).toThrow(
      RangeError,
    );
  });
});