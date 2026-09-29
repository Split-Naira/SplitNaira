"use client";

/**
 * An explorer link that can be *honestly* absent (#1114).
 *
 * `lib/explorer.ts` (#1311) deliberately returns `null` for an unrecognised
 * network or a missing hash, on the principle that "a missing link is a visible
 * gap; a wrong-environment link is a confident lie". The lib held up its end of
 * that contract — but the UI did not:
 *
 *   <a href={getExplorerUrl(hash, network)}>Verify on {getExplorerLabel(network)} →</a>
 *
 * `getExplorerUrl` returns `string | null`, so on an unsupported network React
 * rendered a link with no `href` (an inert anchor a keyboard user can focus and
 * activate, to no effect) labelled "Verify on " with an empty explorer name.
 * The gap was not visible; it was a broken control.
 *
 * This component makes the two outcomes explicit. It links only when it has
 * *both* a URL and a network label, and otherwise renders a plain, non-focusable
 * message saying so. Callers get one place to change the fallback copy.
 */
export interface ExplorerLinkProps {
  /** Explorer URL, or null when one cannot be constructed for this network. */
  url: string | null;
  /**
   * Explorer name for the target chain, or null when the network is
   * unsupported. Required in addition to `url` because a caller may pass an
   * explicit `url` while the network is still unrecognised; the label is what
   * tells the user *which chain* the link points at.
   */
  label: string | null;
  /** Leading link text, e.g. `"Verify on"`. */
  action: string;
  className?: string;
  /** Copy shown in place of the link when it cannot be built. */
  unavailableMessage?: string;
  /** Test hook propagated to both the link and the fallback (suffixed). */
  testId?: string;
}

const DEFAULT_UNAVAILABLE = "Explorer link unavailable for this network";

export function ExplorerLink({
  url,
  label,
  action,
  className,
  unavailableMessage = DEFAULT_UNAVAILABLE,
  testId = "explorer-link",
}: ExplorerLinkProps) {
  if (url && label) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        data-testid={testId}
      >
        {action} {label} →
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    );
  }

  return (
    <span
      data-testid={`${testId}-unavailable`}
      className={`opacity-60 ${className ?? ""}`.trim()}
      title={unavailableMessage}
    >
      {unavailableMessage}
    </span>
  );
}
