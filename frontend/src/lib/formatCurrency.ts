/**
 * Locale-aware formatting for Nigerian naira and supported Stellar assets (#1503).
 *
 * Amounts arrive from several places — contract events, the ledger, and REST
 * responses — and every one of them is a bare integer or decimal string. What
 * the user reads is a formatted string, and that string differs by locale:
 * `₦1,234.56` in `en-NG`, `1 234,56 ₦` in `fr`, `₦1.234,56` in `de`.
 *
 * Three rules this module holds to:
 *
 * 1. **Never guess.** An unrecognised currency or locale is an error, not a
 *    silent fallback. `Intl` will happily render `NaN` or `∞`; a balance that
 *    reads `NaN ₦` is a confident lie, and this app moves money.
 * 2. **Never lose precision quietly.** Asset amounts keep their on-chain
 *    fraction digits so the smallest transferable unit stays visible.
 * 3. **No silent rounding of the sign.** Negatives keep their sign in every
 *    locale rather than relying on a minus glyph that may be localised.
 */

/** Fiat currencies the app can display. */
export const FIAT_CURRENCIES = ['NGN', 'USD', 'EUR'] as const;

export type FiatCurrency = (typeof FIAT_CURRENCIES)[number];

/**
 * Stellar assets the app supports as payout currencies.
 *
 * Sourced from `KNOWN_TOKENS` in `lib/token-constants`. Custom tokens are
 * deliberately excluded: their codes are user-supplied contract metadata, so
 * they cannot be validated against a closed list here.
 */
export const ASSET_CODES = ['XLM', 'USDC', 'EURC'] as const;

export type AssetCode = (typeof ASSET_CODES)[number];

/**
 * One XLM is 10,000,000 stroops — Stellar's base unit.
 *
 * Exposed so call sites converting from on-chain integers do not each
 * hardcode the divisor.
 */
export const STROOPS_PER_UNIT = 10_000_000;

/**
 * Fraction digit bounds per asset.
 *
 * XLM allows all 7 on-chain digits but does not pad to them, so the smallest
 * transferable amount (one stroop, 0.0000001 XLM) stays visible while a whole
 * unit still reads as `1 XLM` rather than `1.0000000 XLM`. USDC and EURC are
 * fiat-pegged and conventionally rendered with exactly 2 digits.
 */
const ASSET_FRACTION_DIGITS: Readonly<
  Record<AssetCode, { min: number; max: number }>
> = {
  XLM: { min: 0, max: 7 },
  USDC: { min: 2, max: 2 },
  EURC: { min: 2, max: 2 },
};

/** Fraction digits per fiat currency, per ISO 4217. */
const FIAT_FRACTION_DIGITS: Readonly<Record<FiatCurrency, number>> = {
  NGN: 2,
  USD: 2,
  EUR: 2,
};

function assertFiniteAmount(amount: unknown): asserts amount is number {
  if (typeof amount !== 'number') {
    throw new TypeError(
      `Amount must be a number, received ${typeof amount}.`,
    );
  }
  if (!Number.isFinite(amount)) {
    throw new RangeError(
      `Amount must be a finite number, received ${String(amount)}.`,
    );
  }
}

/**
 * Validates a locale tag, failing loudly rather than falling back to English.
 *
 * `Intl.NumberFormat` accepts structurally valid tags only; anything else
 * throws. We catch it to attach which value was at fault, because the default
 * locale is otherwise invisible in a stack trace.
 */
function assertLocale(locale: unknown): asserts locale is string {
  if (typeof locale !== 'string' || locale.trim() === '') {
    throw new TypeError(
      `Locale must be a non-empty string, received ${JSON.stringify(locale)}.`,
    );
  }
  try {
    new Intl.NumberFormat(locale);
  } catch {
    throw new RangeError(
      `Unsupported locale tag: ${JSON.stringify(locale)}. ` +
        'Expected a BCP 47 tag such as "en", "en-NG" or "fr".',
    );
  }
}

function assertFiatCurrency(currency: unknown): asserts currency is FiatCurrency {
  if (
    typeof currency !== 'string' ||
    !(FIAT_CURRENCIES as readonly string[]).includes(currency)
  ) {
    throw new RangeError(
      `Unsupported fiat currency: ${JSON.stringify(currency)}. ` +
        `Supported currencies are ${FIAT_CURRENCIES.join(', ')}.`,
    );
  }
}

function assertAssetCode(code: unknown): asserts code is AssetCode {
  if (
    typeof code !== 'string' ||
    !(ASSET_CODES as readonly string[]).includes(code)
  ) {
    throw new RangeError(
      `Unsupported asset code: ${JSON.stringify(code)}. ` +
        `Supported assets are ${ASSET_CODES.join(', ')}.`,
    );
  }
}

/**
 * Formats a fiat amount for display.
 *
 * @example
 * formatCurrency(1234.56, 'en-NG', 'NGN'); // '₦1,234.56'
 * formatCurrency(1234.56, 'de', 'NGN');    // '1.234,56 NGN'
 * formatCurrency(-50, 'en-US', 'USD');      // '-$50.00'
 *
 * @param amount - Value in whole currency units (not stroops, not kobo).
 * @param locale - BCP 47 tag driving separators, symbol placement and digits.
 * @param currency - ISO 4217 code. Restricted to {@link FIAT_CURRENCIES}.
 * @throws {TypeError} When `amount` or `locale` is not of the expected type.
 * @throws {RangeError} When `amount` is not finite, or the locale or currency
 *   is not supported.
 */
export function formatCurrency(
  amount: number,
  locale: string,
  currency: FiatCurrency,
): string {
  assertFiniteAmount(amount);
  assertLocale(locale);
  assertFiatCurrency(currency);

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: FIAT_FRACTION_DIGITS[currency],
    maximumFractionDigits: FIAT_FRACTION_DIGITS[currency],
  }).format(amount);
}

/**
 * Formats a Stellar asset amount for display.
 *
 * Asset codes are not ISO 4217 codes, so `Intl`'s currency style cannot be
 * used — it would reject `XLM`. The code is appended instead, which also keeps
 * the number grouping intact in every locale.
 *
 * @example
 * formatAsset(1234.5678, 'en', 'XLM'); // '1,234.5678 XLM'
 * formatAsset(-25, 'en', 'USDC');       // '-25.00 USDC'
 *
 * @param amount - Value in whole asset units (see {@link formatStroops} for
 *   on-chain stroop integers).
 * @param locale - BCP 47 tag driving grouping and decimal separators.
 * @param code - Asset code. Restricted to {@link ASSET_CODES}.
 * @throws {TypeError} When `amount` or `locale` is not of the expected type.
 * @throws {RangeError} When `amount` is not finite, or the locale or asset
 *   code is not supported.
 */
export function formatAsset(
  amount: number,
  locale: string,
  code: AssetCode,
): string {
  assertFiniteAmount(amount);
  assertLocale(locale);
  assertAssetCode(code);

  const digits = ASSET_FRACTION_DIGITS[code];

  return `${new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits.min,
    maximumFractionDigits: digits.max,
  }).format(amount)} ${code}`;
}

/**
 * Formats an on-chain stroop integer as a readable asset amount.
 *
 * Every Stellar balance in this app arrives as a stroop integer, so this is
 * the function call sites actually want. Division happens before formatting so
 * rounding is applied once, by the formatter, rather than twice.
 *
 * @example
 * formatStroops(10_000_000, 'en', 'XLM'); // '1 XLM'
 * formatStroops(1, 'en', 'XLM');           // '0.0000001 XLM'
 *
 * @param stroops - Integer amount in stroops. Must be finite; it need not be
 *   an integer, since fractional stroops are representable.
 * @param locale - BCP 47 tag driving grouping and decimal separators.
 * @param code - Asset code. Restricted to {@link ASSET_CODES}.
 * @throws {TypeError} When `stroops` or `locale` is not of the expected type.
 * @throws {RangeError} When `stroops` is not finite, or the locale or asset
 *   code is not supported.
 */
export function formatStroops(
  stroops: number,
  locale: string,
  code: AssetCode,
): string {
  assertFiniteAmount(stroops);
  assertLocale(locale);
  assertAssetCode(code);

  return formatAsset(stroops / STROOPS_PER_UNIT, locale, code);
}