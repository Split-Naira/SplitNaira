export type StellarNetwork = "testnet" | "mainnet";

export interface Collaborator {
  address: string;
  alias: string;
  basisPoints: number;
}

export type ParticipantPaymentState = "paid" | "pending" | "failed" | "unpaid";

export interface ParticipantPaymentStatus {
  address: string;
  alias: string | null;
  basisPoints: number;
  status: ParticipantPaymentState;
  roundId: string | null;
  lastUpdated: number | null;
}

export interface SplitProject {
  projectId: string;
  title: string;
  projectType: string;
  token: string;
  owner: string;
  collaborators: Array<Collaborator>;
  locked: boolean;
  totalDistributed: string;
  distributionRound: number;
  balance: string;
  participantPaymentStatuses?: ParticipantPaymentStatus[] | null;
}

// Extended type for frontend backward compatibility
export type SplitProjectWithBalance = SplitProject;

export function getHorizonUrl(network: StellarNetwork) {
  return network === "mainnet"
    ? "https://horizon.stellar.org"
    : "https://horizon-testnet.stellar.org";
}

/**
 * Explorer helpers now live in `lib/explorer.ts` (#1311), which is the single
 * source of truth. These re-exports keep existing imports working.
 *
 * Note the contract change: both return `null` for an unrecognised network
 * instead of silently falling back to testnet. Callers must render no link in
 * that case rather than a link to the wrong chain.
 */
export {
  getTransactionExplorerUrl as getExplorerUrl,
  getExplorerLabel,
} from "./explorer";

export function formatBasisPoints(bps: number) {
  return `${(bps / 100).toFixed(2)}%`;
}