'use client';

import {useEffect} from 'react';
import {useRouter} from 'next/navigation';
import {useAccount, useWaitForTransactionReceipt, useWriteContract} from 'wagmi';

import {CHAIN_ID, explorerTx} from '@/lib/chain';

/**
 * A write button that reports what actually happened.
 *
 * Every state-changing action in this app runs through here so that "submitted",
 * "confirmed" and "reverted" are distinct, visible outcomes. A dashboard about verifiable
 * settlement should not be the part of the stack that quietly swallows a failed
 * transaction.
 */
export function TxButton({
  label,
  pendingLabel = 'Confirming…',
  disabled,
  disabledReason,
  className = '',
  request,
  onConfirmed,
}: {
  label: string;
  pendingLabel?: string;
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
  request: () => Parameters<ReturnType<typeof useWriteContract>['writeContract']>[0] | null;
  onConfirmed?: () => void;
}) {
  const router = useRouter();
  const {isConnected, chainId} = useAccount();
  const {writeContract, data: hash, isPending, error, reset} = useWriteContract();
  const {isLoading: isMining, isSuccess, error: receiptError} = useWaitForTransactionReceipt({hash});

  useEffect(() => {
    if (!isSuccess) return;
    onConfirmed?.();
    // Server components hold the market state, so a refresh is what makes the new pool
    // sizes appear rather than a local optimistic guess that might be wrong.
    router.refresh();
  }, [isSuccess, onConfirmed, router]);

  const wrongNetwork = isConnected && chainId !== CHAIN_ID;
  const blocked = !isConnected || wrongNetwork || disabled;
  const reason = !isConnected
    ? 'Connect a wallet first'
    : wrongNetwork
      ? 'Switch to the right network'
      : disabledReason;

  const failure = error ?? receiptError;

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={blocked || isPending || isMining}
        title={blocked ? reason : undefined}
        onClick={() => {
          reset();
          const config = request();
          if (config) writeContract(config);
        }}
        className={`w-full rounded-md px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
      >
        {isPending ? 'Check your wallet…' : isMining ? pendingLabel : label}
      </button>

      {blocked && reason && <p className="text-xs text-ink-faint">{reason}</p>}

      {failure && (
        <p className="rounded-md bg-no-dim px-2 py-1.5 text-xs leading-relaxed text-no">
          {shortenError(failure.message)}
        </p>
      )}

      {isSuccess && hash && (
        <p className="text-xs text-yes">
          Confirmed ·{' '}
          <a href={explorerTx(hash)} target="_blank" rel="noreferrer" className="underline">
            view transaction
          </a>
        </p>
      )}
    </div>
  );
}

/** Wallet errors are paragraphs; the first meaningful line is what a user can act on. */
function shortenError(message: string): string {
  const known: [RegExp, string][] = [
    [/PositionCapExceeded/, 'That would exceed the 1 USDC per-position cap.'],
    [/ExposureCapExceeded/, 'That would exceed your total open-exposure cap.'],
    [/MarketClosed/, 'This market has closed for new positions.'],
    [/TooEarlyToResolve/, 'The settlement time has not been reached yet.'],
    [/ResolverUndecided/, 'The data source cannot decide yet. Try again later.'],
    [/AlreadyResolved/, 'This market has already settled.'],
    [/NothingToClaim/, 'There is nothing to claim on this market.'],
    [/FaucetCooldown/, 'The faucet is cooling down for this address. Try again in an hour.'],
    [/User rejected|denied transaction/i, 'You rejected the transaction in your wallet.'],
    [/insufficient funds/i, 'Not enough CELO to pay for gas.'],
  ];
  for (const [pattern, friendly] of known) if (pattern.test(message)) return friendly;
  return message.split('\n')[0]!.slice(0, 200);
}
