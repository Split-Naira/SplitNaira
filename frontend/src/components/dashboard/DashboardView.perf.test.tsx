/* @vitest-environment jsdom */

/**
 * Performance smoke test for DashboardView.
 *
 * See docs/frontend-performance-profiling.md for the local profiling
 * workflow (React/Chrome DevTools) to use if this test ever fails or a
 * real regression needs investigating.
 *
 * This is intentionally a *smoke* test, not a benchmark: it renders the
 * dashboard once with a large, fully deterministic fixture and asserts
 * that render time stays under a deliberately generous ceiling. The goal
 * is to catch a catastrophic regression (e.g. an accidental O(n^2) loop,
 * a runaway re-render, or a virtualization removal) before release — not
 * to enforce a tight performance SLA. Coarse thresholds are used on
 * purpose to avoid flakiness on slower/shared CI runners.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { DashboardView } from "./DashboardView";
import type { AllowlistActionResult } from "./DashboardView";
import type { SplitProject } from "@/lib/stellar";
import type { WalletState } from "@/lib/wallet";

// ---------------------------------------------------------------------------
// Deterministic large fixture
// ---------------------------------------------------------------------------

/**
 * Fixture size rationale: 800 projects is well past what any real dashboard
 * would show today, but small enough to keep this test fast and non-flaky
 * in CI. The "Project Performance Rollups" table in DashboardView maps over
 * the entire `dashboardData` array with no virtualization/pagination and no
 * memoization on a per-row basis, so it renders one `<tr>` (with several
 * `sanitizeText()` calls each) per project — this is the most likely real
 * bottleneck for "large project lists," and a count in the hundreds is
 * enough to plausibly surface an accidental O(n^2) loop or an unnecessary
 * re-render without making the test itself slow.
 *
 * Every field is derived purely from the index `i` (no `Math.random()`, no
 * wall-clock timestamps), so the fixture — and therefore this test's
 * behavior — is 100% reproducible across runs and machines.
 */
const FIXTURE_SIZE = 800;

const PROJECT_TYPES = ["App", "Content", "Service", "Media"];

function buildCollaborators(projectIndex: number): SplitProject["collaborators"] {
  // Three collaborators per project, deterministic addresses/aliases, basis
  // points summing to 10000 (100.00%).
  return [
    { address: `GCOLLAB${projectIndex}-0`, alias: `Collaborator ${projectIndex}-0`, basisPoints: 3334 },
    { address: `GCOLLAB${projectIndex}-1`, alias: `Collaborator ${projectIndex}-1`, basisPoints: 3333 },
    { address: `GCOLLAB${projectIndex}-2`, alias: `Collaborator ${projectIndex}-2`, basisPoints: 3333 },
  ];
}

function buildLargeDashboardFixture(count: number): SplitProject[] {
  return Array.from({ length: count }, (_, i) => {
    const project: SplitProject = {
      projectId: `proj-${i}`,
      title: `Project ${i}`,
      projectType: PROJECT_TYPES[i % PROJECT_TYPES.length],
      token: `TOKEN${i % 5}`,
      owner: `GOWNER${i}`,
      collaborators: buildCollaborators(i),
      locked: i % 7 === 0,
      totalDistributed: String(i * 500),
      distributionRound: i % 12,
      balance: String(i * 1000),
    };
    return project;
  });
}

const largeFixture = buildLargeDashboardFixture(FIXTURE_SIZE);

function noop() {
  // intentionally empty
}

async function asyncNoop(): Promise<void> {
  // intentionally empty
}

async function asyncNoopUnknown(): Promise<unknown> {
  return null;
}

const disconnectedWallet: WalletState = {
  connected: false,
  address: null,
  network: null,
};

/**
 * Baseline props for a "disconnected wallet, non-admin" viewer. This keeps
 * the admin panels (token allowlist / recovery console / pause control) and
 * the "Your Cumulative Earnings" section collapsed, so the render exercises
 * the summary cards plus the unconditional "Project Performance Rollups"
 * table at full fixture scale — the actual scenario this smoke test targets.
 */
function buildBaseProps(dashboardData: SplitProject[]) {
  return {
    wallet: disconnectedWallet,
    isContractAdmin: false,
    tokenAllowlist: null,
    isLoadingAllowlist: false,
    isUpdatingAllowlist: false,
    allowlistTokenInput: "",
    setAllowlistTokenInput: noop,
    isValidAllowlistToken: false,
    normalizedAllowlistToken: "",
    onSubmitAllowlistAction: async (_action: "allow" | "disallow") => {},
    lastAllowlistTx: null as AllowlistActionResult | null,
    refreshTokenAllowlist: asyncNoopUnknown,
    isLoadingDashboard: false,
    dashboardData,
    userEarnings: {} as Record<string, string>,
    adminStatus: null,
    isLoadingAdminStatus: false,
    refreshAdminStatus: asyncNoopUnknown,
    showPauseConfirm: false,
    setShowPauseConfirm: noop,
    showUnpauseConfirm: false,
    setShowUnpauseConfirm: noop,
    isSubmittingPause: false,
    lastPauseTxHash: null,
    onTogglePause: async (_action: "pause" | "unpause") => {},
    recoveryTokenInput: "",
    setRecoveryTokenInput: noop,
    isLoadingUnallocated: false,
    unallocatedError: null,
    unallocatedBalance: null,
    onInspectUnallocated: asyncNoop,
    recoveryToInput: "",
    setRecoveryToInput: noop,
    recoveryAmountInput: "",
    setRecoveryAmountInput: noop,
    showRecoveryConfirm: false,
    setShowRecoveryConfirm: noop,
    isSubmittingRecovery: false,
    onConfirmRecovery: asyncNoop,
    lastRecoveryTxHash: null,
    setActiveTab: noop,
    setSearchProjectId: noop,
    setFetchedProject: noop,
    getExplorerUrl: (_hash: string, _network: string | null) => "https://example.com",
  };
}

describe("DashboardView performance smoke", () => {
  it(`renders ${FIXTURE_SIZE} projects within a generous time budget and without truncating data`, () => {
    const props = buildBaseProps(largeFixture);

    // --- Warmup render (untimed) --------------------------------------
    // The first render of a test file pays for module init, JSX
    // compilation caches, jsdom setup, etc. That one-time cost is not
    // representative of steady-state render performance and is a common
    // source of flakiness in timing assertions, so we discard it here and
    // only time the second render.
    const warmup = render(<DashboardView {...props} />);
    warmup.unmount();
    cleanup();

    // --- Timed render ---------------------------------------------------
    const start = performance.now();
    render(<DashboardView {...props} />);
    const elapsedMs = performance.now() - start;

    // Threshold rationale: 3000ms for an 800-row unvirtualized table render
    // in a jsdom + CI-shared-runner environment is deliberately generous —
    // typical local runs complete in well under a second. This budget
    // exists to catch a catastrophic regression (accidental O(n^2) work,
    // an infinite re-render loop, a virtualization removal that goes very
    // wrong), not to enforce a tight performance SLA. If this ever flakes
    // on a legitimately slower CI runner, raise the threshold rather than
    // optimizing the component under time pressure — see
    // docs/frontend-performance-profiling.md for how to tell the
    // difference between "CI is just slow" and "there is a real
    // regression."
    const RENDER_BUDGET_MS = 3000;
    expect(elapsedMs).toBeLessThan(RENDER_BUDGET_MS);

    // --- Correctness at scale --------------------------------------------
    // A pure timing assertion would still pass if rendering silently
    // truncated the list, so also assert the output reflects the full
    // fixture: the summary card count, the first row, and a row near the
    // end of the (unvirtualized, unpaginated) table.
    expect(screen.getByText(String(FIXTURE_SIZE))).toBeTruthy();
    expect(screen.getByText("Project 0")).toBeTruthy();
    expect(screen.getByText(`Project ${FIXTURE_SIZE - 1}`)).toBeTruthy();
    expect(screen.getAllByText(/^proj-/).length).toBe(FIXTURE_SIZE);
  });
});
