import { render, screen } from "@testing-library/react";
import { WalletError } from "./WalletError";

describe("WalletError", () => {
  it("renders nothing when error is null", () => {
    const { container } = render(<WalletError error={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows friendly message for no_freighter error", () => {
    render(<WalletError error="no_freighter" />);
    expect(screen.getByText(/install the Freighter extension/i)).toBeInTheDocument();
  });

  it("shows friendly message for user_declined error", () => {
    render(<WalletError error="user_declined" />);
    expect(screen.getByText(/approve the request in your Freighter wallet/i)).toBeInTheDocument();
  });

  it("shows fallback message for unknown error", () => {
    render(<WalletError error="some_unknown_error" />);
    expect(screen.getByText(/unexpected wallet error/i)).toBeInTheDocument();
  });
});
