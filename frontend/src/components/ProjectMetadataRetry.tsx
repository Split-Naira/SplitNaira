import { useState } from "react";

type Metadata = {
  name: string;
  description: string;
};

type ProjectMetadataRetryProps = {
  metadata: Metadata;
  onRetry: (metadata: Metadata) => Promise<void>;
  onCancel: () => void;
};

export function ProjectMetadataRetry({
  metadata,
  onRetry,
  onCancel,
}: ProjectMetadataRetryProps) {
  const [isRetrying, setIsRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRetry = async () => {
    setIsRetrying(true);
    setError(null);

    try {
      await onRetry(metadata);
    } catch {
      setError("Unable to update project metadata. Please try again.");
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <div>
      {error && <p role="alert">{error}</p>}

      <button
        type="button"
        onClick={handleRetry}
        disabled={isRetrying}
      >
        {isRetrying ? "Retrying..." : "Retry"}
      </button>

      <button
        type="button"
        onClick={onCancel}
        disabled={isRetrying}
      >
        Cancel
      </button>
    </div>
  );
}