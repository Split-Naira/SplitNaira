# Currency Formatting

Developer reference for `frontend/src/lib/formatCurrency.ts`, which renders
Nigerian naira and supported Stellar assets for display (#1503).

## Why this exists

Amounts reach the frontend as bare integers and decimal strings — from contract
events, the ledger and REST responses. What a user reads is a formatted string,
and that string is locale-dependent. The same balance is:

| Locale  | Output         |
| ------- | -------------- |
| `en-NG` | `₦1,234.56`    |
| `en`    | `NGN 1,234.56` |
| `de`    | `1.234,56 NGN` |
| `fr`    | `1 234,56 NGN` |

Note that `₦` only appears in `en-NG`. Other locales render the ISO code, which
is correct: a Nigerian naira symbol shown to a German reader is a bug, not a
polish.

## API

### `formatCurrency(amount, locale, currency)`

Formats a fiat amount. `amount` is in whole currency units — naira, not kobo.

```ts
formatCurrency(1234.56, "en-NG", "NGN"); // '₦1,234.56'
formatCurrency(-50, "en-US", "USD"); // '-$50.00'
```

Supported: `NGN`, `USD`, `EUR`. All use 2 fraction digits.

### `formatAsset(amount, locale, code)`

Formats a Stellar asset. Asset codes are not ISO 4217 codes, so `Intl`'s
currency style rejects them; the code is appended instead, which preserves
grouping in every locale.

```ts
formatAsset(1234.5678, "en", "XLM"); // '1,234.5678 XLM'
formatAsset(25, "en", "USDC"); // '25.00 USDC'
```

Supported: `XLM`, `USDC`, `EURC`, sourced from `KNOWN_TOKENS` in
`lib/token-constants`.

Custom tokens are deliberately excluded. Their codes are user-supplied contract
metadata and cannot be validated against a closed list here.

Fraction digits differ by asset on purpose:

- **XLM** allows up to 7 on-chain digits but does not pad to them. The smallest
  transferable amount is one stroop (`0.0000001 XLM`), and padding a whole unit
  to seven digits renders `1 XLM` as `1.0000000 XLM`.
- **USDC / EURC** use exactly 2 digits, matching how fiat-pegged assets appear on
  exchanges.

### `formatStroops(stroops, locale, code)`

Every on-chain Stellar balance is an integer of stroops, so this is what most
call sites want. Division happens before formatting, so rounding is applied
once, by the formatter, rather than twice.

```ts
formatStroops(10_000_000, "en", "XLM"); // '1 XLM'
formatStroops(1, "en", "XLM"); // '0.0000001 XLM'
```

Use `STROOPS_PER_UNIT` rather than hardcoding the divisor.

## Failure behaviour

The module never guesses. Formatting a value it cannot represent honestly is an
error, not a fallback:

| Input                              | Throws       |
| ---------------------------------- | ------------ |
| `NaN`, `Infinity`, `-Infinity`     | `RangeError` |
| Non-number `amount`                | `TypeError`  |
| Unsupported currency or asset code | `RangeError` |
| Structurally invalid locale tag    | `RangeError` |
| Empty or non-string locale         | `TypeError`  |

The error message names the offending value, because a default locale is
otherwise invisible in a stack trace.

`Intl` would happily render `NaN` and `∞`. A balance reading `NaN ₦` is a
confident lie, and this app moves money.

## ICU version caveat

**Do not assert on raw formatted output across locales.**

French grouping uses U+202F (narrow no-break space) on current ICU and U+00A0
on older builds; some locales use U+2212 (minus sign) rather than ASCII hyphen.
A test asserting the literal string will fail on an ICU upgrade for reasons
unrelated to the code under test.

Normalise before comparing — see `normalise()` in
`frontend/src/lib/__tests__/formatCurrency.test.ts`:

```ts
const normalise = (value: string) =>
  value.replace(/[\u00A0\u202F]/g, " ").replace(/\u2212/g, "-");
```

This is not hypothetical: the repository's own
`CreateSplitWizard.i18n.test.tsx` was failing for years because of a similar
assumption, and the underlying cause turned out to be an unrelated
locale-blind test mock.

## Accessibility

These functions are pure string formatters with no DOM output, so they add no
keyboard or screen-reader surface of their own. Nothing about the accessibility
of a component changes when it starts calling them.

Two things to keep in mind when rendering their output:

- The formatted string is what assistive technology announces. A negative
  amount keeps a real minus sign rather than relying on a localised glyph, so
  it is announced as a negative number rather than read as a positive one.
- If a formatted amount appears inside a control whose accessible name would
  otherwise be uninformative, give that control an explicit `aria-label` with
  the plain value. Grouping separators are decorative; the name should not
  depend on them.

## Testing

Tests live in `frontend/src/lib/__tests__/formatCurrency.test.ts` and cover
success, failure and boundary cases: zero, negative values, one kobo, a single
stroop, sub-kobo rounding, large amounts, `Number.MAX_SAFE_INTEGER`, and every
rejected input.

Vitest globals are enabled in `vitest.config.ts`, but `tsconfig.json` does not
include `vitest/globals` types, so tests must still import explicitly:

```ts
import { describe, expect, it } from "vitest";
```

Omitting the import still runs, but produces nine `TS2304`/`TS2582` type errors
that `next build` does not surface and lint does not catch.

## Current adoption

This module is **not yet called by any component.** Existing components format
amounts with a bare `.toLocaleString()`, which uses the _host_ default locale
rather than the route's `[locale]` — so number formatting currently ignores the
user's selected language. Wiring this module into those call sites is follow-up
work tracked separately from #1503.
