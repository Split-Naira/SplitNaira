/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  TransactionReceiptView,
  type TransactionReceipt,
} from "../TransactionReceiptView";

const HASH = "a".repeat(64);

const receipt = (
  overrides: Partial<TransactionReceipt> = {},
): TransactionReceipt => ({
  hash: HASH,
  lifecycle: "success",
  action: "deposit",
  projectId: "P123",
  amount: "100",
  ...overrides,
});

const renderReceipt = (
  overrides: Partial<TransactionReceipt> = {},
  network: string | null = "testnet",
) =>
  render(
    <TransactionReceiptView
      receipt={receipt(overrides)}
      network={network}
      enableRealtime={false}
    />,
  );

describe("TransactionReceiptView explorer link", () => {
  it("links to the right explorer for a supported network", () => {
    renderReceipt({}, "mainnet");

    const link = screen.getByRole("link", { name: /verify on/i });
    expect(link).toHaveAttribute(
      "href",
      expect.stringContaining("stellar.expert/explorer/public/tx/"),
    );
    expect(screen.queryByTestId("explorer-link-unavailable")).toBeNull();
  });

  it("renders an explicit fallback, not a broken anchor, on an unsupported network", () => {
    renderReceipt({}, "futurenet");

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByTestId("explorer-link-unavailable")).toHaveTextContent(
      /available/i,
    );
  });

  it("renders the fallback when the network is unknown (null)", () => {
    renderReceipt({}, null);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByTestId("explorer-link-unavailable")).toBeInTheDocument();
  });

  it("renders the fallback for a failed receipt whose network cannot be linked", () => {
    renderReceipt({ lifecycle: "failed" }, "futurenet");

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByTestId("explorer-link-unavailable")).toBeInTheDocument();
  });

  it("still links a failed receipt when the network is supported", () => {
    renderReceipt({ lifecycle: "failed" }, "testnet");

    expect(
      screen.getByRole("link", { name: /inspect on/i }),
    ).toHaveAttribute("href", expect.stringContaining("/testnet/tx/"));
  });

  it("uses an explicitly supplied explorerUrl and label verbatim", () => {
    const url = "https://example.test/tx/" + HASH;
    render(
      <TransactionReceiptView
        receipt={receipt()}
        network="futurenet"
        explorerUrl={url}
        explorerLabel="Example Explorer"
        enableRealtime={false}
      />,
    );

    expect(
      screen.getByRole("link", { name: /verify on example explorer/i }),
    ).toHaveAttribute("href", url);
  });

  it("falls back when a url is supplied without a resolvable network label", () => {
    render(
      <TransactionReceiptView
        receipt={receipt()}
        network="futurenet"
        explorerUrl={`https://stellar.expert/explorer/testnet/tx/${HASH}`}
        enableRealtime={false}
      />,
    );

    // A link whose label cannot be resolved would read "Verify on " — the
    // fallback is the honest rendering.
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByTestId("explorer-link-unavailable")).toBeInTheDocument();
  });
});
