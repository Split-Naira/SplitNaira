# Frontend Component Testing Contributor Guide

This guide outlines the standards and procedures for contributing component unit and integration tests to the SplitNaira frontend application (`frontend/`).

## Testing Stack & Tools
* **Test Runner:** Vitest (`vitest.config.ts`, jsdom environment). Tests live under `frontend/src` and are named `*.test.ts(x)`.
* **Component Rendering:** `@testing-library/react` for querying rendered DOM nodes semantically.
* **DOM Assertions:** `@testing-library/jest-dom`, registered globally in `frontend/src/test/setup.ts`.
* **Runner globals:** enabled via `globals: true`, but `tsconfig.json` does not include `vitest/globals` types. Import `describe` / `it` / `expect` from `vitest` explicitly, or `tsc` will report errors that neither lint nor `next build` catches.

## Writing Component Tests

Place component tests adjacent to their corresponding components using the `.test.tsx` naming convention:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/Button';

describe('Button Component', () => {
  it('renders correctly with label and handles click events', () => {
    const handleClick = vi.fn();
    render(<Button label="Submit Split" onClick={handleClick} />);

    const buttonElement = screen.getByRole('button', { name: /submit split/i });
    expect(buttonElement).toBeInTheDocument();

    fireEvent.click(buttonElement);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
```

## Testing Localised Output

`src/test/setup.ts` globally mocks `next-intl`. The mock reads the messages
handed to `NextIntlClientProvider` and falls back to `en.json` when no provider
is mounted, so a non-English test must pass `locale` and `messages` explicitly:

```tsx
render(
  <NextIntlClientProvider locale="fr" messages={frMessages}>
    <ComponentUnderTest />
  </NextIntlClientProvider>,
);
```

If a localised assertion fails, confirm the provider is actually mounted before
suspecting the component — the mock renders English by default and will not
report a missing provider.

Do not assert on raw output containing locale-specific separators. See
[Currency Formatting](../currency-formatting.md#icu-version-caveat) for the
normalisation helper and why an ICU upgrade can otherwise fail an unrelated
test.