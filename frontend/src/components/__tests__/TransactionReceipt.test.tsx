import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { TransactionReceipt } from '../TransactionReceipt';

describe('TransactionReceipt', () => {
  const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

  it('renders pending state correctly', () => {
    render(<TransactionReceipt status="pending" isStale={false} txHash={mockTxHash} />);
    expect(screen.getByText('Processing Transaction...')).toBeInTheDocument();
  });

  it('displays recovery buttons when pending becomes stale', () => {
    const handleRetry = jest.fn();
    const handleRefresh = jest.fn();

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
    const handleRetry = jest.fn();
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
  it('links to the explorer URL it is given, verbatim', () => {
    const url = 'https://stellar.expert/explorer/public/tx/' + mockTxHash;
    render(
      <TransactionReceipt
        status="pending"
        isStale={false}
        txHash={mockTxHash}
        explorerUrl={url}
      />
    );

    const link = screen.getByLabelText('View on Stellar Explorer');
    expect(link).toHaveAttribute('href', url);
  });

  it('renders no explorer link when no URL is supplied (#1311)', () => {
    // It used to default to a testnet base, so a mainnet transaction linked to
    // an explorer that had never seen it. No link beats a wrong one.
    render(<TransactionReceipt status="pending" isStale={false} txHash={mockTxHash} />);
    expect(screen.queryByLabelText('View on Stellar Explorer')).toBeNull();
  });

  it('renders no explorer link when the URL is null', () => {
    render(
      <TransactionReceipt
        status="pending"
        isStale={false}
        txHash={mockTxHash}
        explorerUrl={null}
      />
    );
    expect(screen.queryByLabelText('View on Stellar Explorer')).toBeNull();
  });

  it('wraps long transaction hashes instead of clipping them (#1600)', () => {
    // `truncate` clips with an ellipsis and, inside a flex row without
    // `min-w-0`, lets the hash push the card wider than the viewport on
    // mobile and in print. The hash must wrap in place instead.
    render(<TransactionReceipt status="pending" isStale={false} txHash={mockTxHash} />);

    const hashEl = screen.getByText(mockTxHash);
    expect(hashEl.className).toContain('break-all');
    expect(hashEl.className).not.toContain('truncate');

    const hashContainer = hashEl.parentElement;
    expect(hashContainer?.className).toContain('min-w-0');
    expect(hashContainer?.className).not.toContain('truncate');
  });
});
