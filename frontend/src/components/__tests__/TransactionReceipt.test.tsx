import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TransactionReceipt } from '../TransactionReceipt';

describe('TransactionReceipt', () => {
  const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

  it('renders pending state correctly', () => {
    render(<TransactionReceipt status="pending" isStale={false} txHash={mockTxHash} />);
    expect(screen.getByText('Processing Transaction...')).toBeInTheDocument();
  });

  it('displays recovery buttons when pending becomes stale', () => {
    const handleRetry = vi.fn();
    const handleRefresh = vi.fn();

    render(
      <TransactionReceipt
        status="pending"
        isStale={true}
        txHash={mockTxHash}
        onRetry={handleRetry}
        onRefresh={handleRefresh}
      />
    );

    expect(screen.getByText('Taking Longer Than Expected')).toBeInTheDocument();
    expect(screen.getByText('Refresh Status')).toBeInTheDocument();
    expect(screen.getByText('Retry Submission')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Refresh Status'));
    expect(handleRefresh).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Retry Submission'));
    expect(handleRetry).toHaveBeenCalledTimes(1);
  });

  it('renders failed state with explicit retry option', () => {
    const handleRetry = vi.fn();
    render(
      <TransactionReceipt
        status="failed"
        isStale={false}
        txHash={mockTxHash}
        errorMessage="Custom error message"
        onRetry={handleRetry}
      />
    );

    expect(screen.getByText('Transaction Failed')).toBeInTheDocument();
    expect(screen.getByText('Custom error message')).toBeInTheDocument();
    expect(screen.getByText('Retry Transaction')).toBeInTheDocument();
  });
});
