export interface DeploymentStatus {
  id: string;
  status: 'success' | 'failed' | 'rolled_back';
  timestamp: number;
  commit: string;
  environment: string;
}