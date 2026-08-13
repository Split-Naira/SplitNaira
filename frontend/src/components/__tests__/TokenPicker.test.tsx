/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TokenPicker } from "../TokenPicker";
import { KNOWN_TOKENS } from "@/lib/token-constants";

describe("TokenPicker", () => {
  it("sets the form value when a preset token is selected", () => {
    const xlm = KNOWN_TOKENS.find(
      (token) => token.code === "XLM" && token.network === "testnet",
    );
    expect(xlm).toBeDefined();

    const handleChange = vi.fn();
    render(
      <TokenPicker
        value=""
        onChange={handleChange}
        network="testnet"
        required
      />,
    );

    fireEvent.change(screen.getByLabelText(/asset token/i), {
      target: { value: xlm!.id },
    });

    expect(handleChange).toHaveBeenCalledWith(xlm!.id);
  });

  it("allows arbitrary custom token input", () => {
    const handleChange = vi.fn();
    render(<TokenPicker value="" onChange={handleChange} network="testnet" />);

    fireEvent.change(screen.getByLabelText(/asset token/i), {
      target: { value: "custom" },
    });
    fireEvent.change(screen.getByLabelText(/custom token contract/i), {
      target: { value: "CUSTOM_TOKEN_CONTRACT" },
    });

    expect(handleChange).toHaveBeenCalledWith("CUSTOM_TOKEN_CONTRACT");
  });

  describe("accessibility & keyboard behaviour (#841)", () => {
    it("marks the select as required and aria-required when required=true", () => {
      render(
        <TokenPicker
          value=""
          onChange={() => {}}
          network="testnet"
          required
        />,
      );
      const select = screen.getByLabelText(/asset token/i) as HTMLSelectElement;
      expect(select.required).toBe(true);
      expect(select.getAttribute("aria-required")).toBe("true");
    });

    it("exposes aria-invalid and aria-describedby when an error is provided", () => {
      render(
        <TokenPicker
          value=""
          onChange={() => {}}
          network="testnet"
          error="Pick a known token to continue"
        />,
      );
      const select = screen.getByLabelText(/asset token/i);
      expect(select.getAttribute("aria-invalid")).toBe("true");
      const describedBy = select.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      expect(screen.getByRole("alert").id).toBe(describedBy);
    });

    it("exposes aria-disabled on the wrapping group when disabled", () => {
      const { container } = render(
        <TokenPicker
          value=""
          onChange={() => {}}
          network="testnet"
          disabled
        />,
      );
      const group = container.querySelector("[aria-disabled='true']");
      expect(group).not.toBeNull();
      const select = screen.getByLabelText(/asset token/i);
      expect(select).toBeDisabled();
    });

    it("renders the custom input as aria-required when required + custom", () => {
      render(
        <TokenPicker
          value=""
          onChange={() => {}}
          network="testnet"
          required
        />,
      );
      fireEvent.change(screen.getByLabelText(/asset token/i), {
        target: { value: "custom" },
      });
      const input = screen.getByLabelText(/custom token contract/i) as HTMLInputElement;
      expect(input.required).toBe(true);
      expect(input.getAttribute("aria-required")).toBe("true");
    });

    it("Escape on the picker clears the current selection and calls onChange('') ", () => {
      const xlm = KNOWN_TOKENS.find(
        (token) => token.code === "XLM" && token.network === "testnet",
      )!;
      const handleChange = vi.fn();
      render(
        <TokenPicker
          value={xlm.id}
          onChange={handleChange}
          network="testnet"
        />,
      );

      const select = screen.getByLabelText(/asset token/i);
      select.focus();
      fireEvent.keyDown(select, { key: "Escape" });

      expect(handleChange).toHaveBeenCalledWith("");
    });

    it("Escape on the custom input clears the custom value and calls onChange('') ", () => {
      const handleChange = vi.fn();
      render(
        <TokenPicker
          value=""
          onChange={handleChange}
          network="testnet"
        />,
      );

      fireEvent.change(screen.getByLabelText(/asset token/i), {
        target: { value: "custom" },
      });
      const input = screen.getByLabelText(/custom token contract/i);
      fireEvent.change(input, { target: { value: "CABC" } });
      input.focus();
      fireEvent.keyDown(input, { key: "Escape" });

      // Final onChange call after Escape must reset to "".
      expect(handleChange).toHaveBeenLastCalledWith("");
    });

    it("Escape restores focus to the previously focused element", () => {
      const xlm = KNOWN_TOKENS.find(
        (token) => token.code === "XLM" && token.network === "testnet",
      )!;
      render(
        <div>
          <button data-testid="trigger">Open picker</button>
          <TokenPicker value={xlm.id} onChange={() => {}} network="testnet" />
        </div>,
      );

      const trigger = screen.getByTestId("trigger");
      trigger.focus();
      expect(document.activeElement).toBe(trigger);

      const select = screen.getByLabelText(/asset token/i);
      select.focus();
      expect(document.activeElement).toBe(select);

      fireEvent.keyDown(select, { key: "Escape" });

      // Focus returns to whatever held focus before the picker.
      expect(document.activeElement).toBe(trigger);
    });

    it("ignores Escape when disabled", () => {
      const xlm = KNOWN_TOKENS.find(
        (token) => token.code === "XLM" && token.network === "testnet",
      )!;
      const handleChange = vi.fn();
      render(
        <TokenPicker
          value={xlm.id}
          onChange={handleChange}
          network="testnet"
          disabled
        />,
      );

      fireEvent.keyDown(screen.getByLabelText(/asset token/i), {
        key: "Escape",
      });

      expect(handleChange).not.toHaveBeenCalled();
    });

    it("announces the selected token via aria-live for screen-reader users", () => {
      const xlm = KNOWN_TOKENS.find(
        (token) => token.code === "XLM" && token.network === "testnet",
      )!;
      render(<TokenPicker value={xlm.id} onChange={() => {}} network="testnet" />);

      const live = document.querySelector("[aria-live='polite']");
      expect(live).not.toBeNull();
      expect(live?.textContent).toContain("XLM");
    });
  });
});
