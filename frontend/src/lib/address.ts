export function isOwner(projectOwnerAddress: string, connectedAddress?: string | null): boolean {
  if (!connectedAddress) {
    return false;
  }

  return projectOwnerAddress.toLowerCase() === connectedAddress.toLowerCase();
}
