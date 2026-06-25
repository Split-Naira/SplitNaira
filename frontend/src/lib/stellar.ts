export type StellarNetwork = "testnet" | "mainnet";

export interface Collaborator {
  address: string;
  alias: string;
  basisPoints: number;
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
}

// Extended type for frontend backward compatibility
export type SplitProjectWithBalance = SplitProject;

export function getHorizonUrl(network: StellarNetwork) {
  return network === "mainnet"
    ? "https://horizon.stellar.org"
    : "https://horizon-testnet.stellar.org";
}

export function getExplorerUrl(hash: string, network: StellarNetwork | string | null) {
  const isMainnet = network === "mainnet" || network === "public";
  const baseUrl = isMainnet
    ? "https://stellar.expert/explorer/public"
    : "https://stellar.expert/explorer/testnet";
  return `${baseUrl}/tx/${hash}`;
}

export function getExplorerLabel(network: StellarNetwork | string | null) {
  const isMainnet = network === "mainnet" || network === "public";
  return isMainnet ? "Stellar.expert (Mainnet)" : "Stellar.expert (Testnet)";
}

export function formatBasisPoints(bps: number) {
  return `${(bps / 100).toFixed(2)}%`;
}