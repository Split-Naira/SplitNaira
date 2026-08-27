# Frontend Component Testing Contributor Guide

This guide outlines the standards and procedures for contributing component unit and integration tests to the SplitNaira frontend application (`apps/web`).

## Testing Stack & Tools
* **Test Runner:** Jest configured with `ts-jest` for TypeScript execution.
* **Component Rendering:** `@testing-library/react` for querying rendered DOM nodes semantically.
* **DOM Assertions:** `@testing-library/jest-dom` for robust DOM matchers (e.g., `toBeInTheDocument`, `toBeDisabled`).

## Writing Component Tests

Place component tests adjacent to their corresponding components using the `.spec.tsx` or `.test.tsx` naming convention:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Button } from '@/components/ui/Button';

describe('Button Component', () => {
  it('renders correctly with label and handles click events', () => {
    const handleClick = jest.fn();
    render(<Button label="Submit Split" onClick="{handleClick}"/>);

    const buttonElement = screen.getByRole('button', { name: /submit split/i });
    expect(buttonElement).toBeInTheDocument();

    fireEvent.click(buttonElement);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});