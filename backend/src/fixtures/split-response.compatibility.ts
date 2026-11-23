/**
 * Issue #1637: compatibility fixtures for legacy split response fields.
 *
 * The backend passes through the shapes produced by the on-chain contract
 * (`snake_case`, e.g. `project_id`, `basis_points`) while the generated
 * OpenAPI document and the frontend client prefer `camelCase`. Clients are
 * allowed to keep sending/consuming either casing until the compatibility
 * window closes, so the supported legacy fields are pinned here and exercised
 * by `split-response.compatibility.test.ts`.
 *
 * To add a legacy alias: update `LEGACY_SPLIT_RESPONSE_FIELDS`, both fixtures,
 * and the normalizer. Removing one is a breaking API change and must wait for
 * the window below.
 */

export const SPLIT_RESPONSE_COMPATIBILITY_WINDOW = {
  preferredCasing: "camelCase",
  legacyCasing: "snake_case",
  /** Date the legacy aliases were formally frozen. */
  deprecatedAt: "2026-01-01T00:00:00.000Z",
  /** Date the legacy aliases may be removed. */
  sunset: "2027-01-01T00:00:00.000Z",
  note:
    "Both casings are supported for split/project responses. camelCase wins when a payload " +
    "contains both forms. Legacy aliases must not be removed before the sunset date without a " +
    "major version bump and a frontend release that no longer reads them.",
} as const;

export const LEGACY_SPLIT_RESPONSE_FIELDS = [
  { legacy: "project_id", canonical: "projectId" },
  { legacy: "project_type", canonical: "projectType" },
  { legacy: "total_distributed", canonical: "totalDistributed" },
  { legacy: "distribution_round", canonical: "distributionRound" },
  { legacy: "basis_points", canonical: "basisPoints", nestedIn: "collaborators" },
] as const;

export interface SplitCollaboratorResponse {
  address: string;
  alias: string;
  basisPoints: number;
}

export interface SplitResponse {
  projectId: string;
  title: string;
  projectType: string;
  token: string;
  owner: string;
  locked: boolean;
  balance: string;
  totalDistributed: string;
  distributionRound: number;
  collaborators: SplitCollaboratorResponse[];
}

export const CANONICAL_SPLIT_RESPONSE_FIXTURE: SplitResponse = {
  projectId: "afrobeats_001",
  title: "Afrobeats Collective Vol. 1",
  projectType: "music",
  token: "CDOVDY3MZDG7PHCGVP7EP2EKQ2ENV26DZW6FKLBRN42LOGIZGXZV3WX5",
  owner: "GBJRKIYXAAFD3NZCWJXGUTNKYUQFZC2ANS6LRMBPJCE4IZSMJJMZPQBT",
  locked: false,
  balance: "50000000",
  totalDistributed: "12500000",
  distributionRound: 3,
  collaborators: [
    {
      address: "GCZTK3PNYXCVF7Z3ELVELEJZ7BVGPGPVJ3NVZNI7O6DVCHPA4JU6LXRV",
      alias: "Producer",
      basisPoints: 6000,
    },
    {
      address: "GBG234UA6RBPDD5K6FHMQXHUXB5ALOENQGH24Y3W4ERX2YJNQ4MK4V25",
      alias: "Vocalist",
      basisPoints: 4000,
    },
  ],
};

/** The same response as returned by the contract decoder (`snake_case`). */
export const LEGACY_SPLIT_RESPONSE_FIXTURE = {
  project_id: CANONICAL_SPLIT_RESPONSE_FIXTURE.projectId,
  title: CANONICAL_SPLIT_RESPONSE_FIXTURE.title,
  project_type: CANONICAL_SPLIT_RESPONSE_FIXTURE.projectType,
  token: CANONICAL_SPLIT_RESPONSE_FIXTURE.token,
  owner: CANONICAL_SPLIT_RESPONSE_FIXTURE.owner,
  locked: CANONICAL_SPLIT_RESPONSE_FIXTURE.locked,
  balance: CANONICAL_SPLIT_RESPONSE_FIXTURE.balance,
  total_distributed: CANONICAL_SPLIT_RESPONSE_FIXTURE.totalDistributed,
  distribution_round: CANONICAL_SPLIT_RESPONSE_FIXTURE.distributionRound,
  collaborators: CANONICAL_SPLIT_RESPONSE_FIXTURE.collaborators.map((collaborator) => ({
    address: collaborator.address,
    alias: collaborator.alias,
    basis_points: collaborator.basisPoints,
  })),
} as const;

function stringFrom(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberFrom(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanFrom(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Normalizes either supported casing to the canonical response. `camelCase`
 * takes precedence, so a mixed payload cannot flip a value by supplying a
 * stale legacy alias alongside the current field.
 */
export function normalizeSplitResponse(
  payload: Record<string, unknown>,
): SplitResponse {
  const collaborators = Array.isArray(payload.collaborators)
    ? (payload.collaborators as Record<string, unknown>[])
    : [];

  return {
    projectId: stringFrom(payload.projectId ?? payload.project_id),
    title: stringFrom(payload.title),
    projectType: stringFrom(payload.projectType ?? payload.project_type),
    token: stringFrom(payload.token),
    owner: stringFrom(payload.owner),
    locked: booleanFrom(payload.locked),
    balance: stringFrom(payload.balance, "0"),
    totalDistributed: stringFrom(
      payload.totalDistributed ?? payload.total_distributed,
      "0",
    ),
    distributionRound: numberFrom(
      payload.distributionRound ?? payload.distribution_round,
    ),
    collaborators: collaborators.map((collaborator) => ({
      address: stringFrom(collaborator.address),
      alias: stringFrom(collaborator.alias),
      basisPoints: numberFrom(
        collaborator.basisPoints ?? collaborator.basis_points,
      ),
    })),
  };
}
