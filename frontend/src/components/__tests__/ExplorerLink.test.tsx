/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ExplorerLink } from "../ExplorerLink";

const URL = "https://stellar.expert/explorer/testnet/tx/" + "a".repeat(64);
const LABEL = "Stellar.expert (Testnet)";

describe("ExplorerLink", () => {
  it("renders an explorer link when both a url and a network label exist", () => {
    render(
      <ExplorerLink url={URL} label={LABEL} action="Verify on" testId="link" />,
    );

    const link = screen.getByTestId("link");
    expect(link).toHaveAttribute("href", URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toMatch(/noopener/);
    expect(link).toHaveTextContent(`Verify on ${LABEL}`);
  });

  it("names the network so the user knows which chain the link targets", () => {
    render(<ExplorerLink url={URL} label={LABEL} action="Verify on" testId="link" />);

    expect(
      screen.getByRole("link", { name: /Stellar\.expert \(Testnet\)/ }),
    ).toBeInTheDocument();
  });

  it("warns assistive-tech users that the link opens a new tab", () => {
    render(<ExplorerLink url={URL} label={LABEL} action="Verify on" testId="link" />);

    expect(
      screen.getByRole("link", { name: /opens in a new tab/i }),
    ).toBeInTheDocument();
  });

  it("renders a plain fallback, not an inert anchor, when the url is null", () => {
    render(
      <ExplorerLink url={null} label={LABEL} action="Verify on" testId="link" />,
    );

    expect(screen.queryByTestId("link")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByTestId("link-unavailable")).toHaveTextContent(
      /Explorer link unavailable for this network/,
    );
  });

  it("falls back when a url is present but the network label is not", () => {
    // A caller can supply an explicit url while the network is still
    // unrecognised; a link named "Verify on " would be unplaceable.
    render(
      <ExplorerLink url={URL} label={null} action="Verify on" testId="link" />,
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByTestId("link-unavailable")).toBeInTheDocument();
  });

  it("falls back when neither a url nor a label can be derived", () => {
    render(
      <ExplorerLink url={null} label={null} action="Verify on" testId="link" />,
    );

    expect(screen.getByTestId("link-unavailable")).toBeInTheDocument();
  });

  it("allows the fallback copy to be overridden per call site", () => {
    render(
      <ExplorerLink
        url={null}
        label={null}
        action="Verify on"
        unavailableMessage="Look this transaction up from a Stellar explorer."
        testId="link"
      />,
    );

    expect(screen.getByTestId("link-unavailable")).toHaveTextContent(
      "Look this transaction up from a Stellar explorer.",
    );
  });

  it("defaults to a generic test id when none is supplied", () => {
    render(<ExplorerLink url={null} label={null} action="Verify on" />);

    expect(screen.getByTestId("explorer-link-unavailable")).toBeInTheDocument();
  });
});
