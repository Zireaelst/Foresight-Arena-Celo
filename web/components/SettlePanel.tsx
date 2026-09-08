'use client';

import type {Address} from 'viem';
import {useAccount, useReadContract} from 'wagmi';

import {foresightPoolAbi} from '@/lib/abi.generated';
import {formatUsdc} from '@/lib/format';
import {Outcome} from '@/lib/types';

import {TxButton} from './TxButton';

/**
 * Settlement and claiming.
 *
 * `resolve` is deliberately permissionless in the contract, so this button is offered to
 * everyone rather than to the market's creator: an arena whose markets can only be
 * settled by their author would stall the moment that author goes offline.
 */
export function SettlePanel({
  pool,
  marketId,
  outcome,
  settleable,
}: {
  pool: Address;
  marketId: number;
  outcome: Outcome;
  settleable: boolean;
}) {
  const {address} = useAccount();
  const settled = outcome !== Outcome.Unresolved;

  const {data: payout, refetch: refetchPayout} = useReadContract({
    address: pool,
    abi: foresightPoolAbi,
    functionName: 'previewPayout',
    args: address ? [BigInt(marketId), address] : undefined,
    query: {enabled: Boolean(address) && settled, refetchInterval: 10_000},
  });

  const {data: claimed, refetch: refetchClaimed} = useReadContract({
    address: pool,
    abi: foresightPoolAbi,
    functionName: 'hasClaimed',
    args: address ? [BigInt(marketId), address] : undefined,
    query: {enabled: Boolean(address) && settled, refetchInterval: 10_000},
  });

  if (!settled) {
    return (
      <TxButton
        label="Settle this market"
        pendingLabel="Settling…"
        disabled={!settleable}
        disabledReason={settleable ? undefined : 'The settlement time has not been reached yet.'}
        className="bg-accent text-black hover:bg-accent/90"
        request={() => ({
          address: pool,
          abi: foresightPoolAbi,
          functionName: 'resolve' as const,
          args: [BigInt(marketId)] as const,
        })}
      />
    );
  }

  if (claimed) {
    return <p className="rounded-lg bg-panel-2 px-3 py-2.5 text-xs text-ink-faint">You have already claimed here.</p>;
  }

  const amount = typeof payout === 'bigint' ? payout : 0n;

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-dim tnum">
        {amount > 0n
          ? `You can claim ${formatUsdc(amount)}.`
          : 'Nothing to claim: you either held no position or your side lost.'}
      </p>
      <TxButton
        label={outcome === Outcome.Void ? 'Claim refund' : 'Claim payout'}
        pendingLabel="Claiming…"
        disabled={amount === 0n}
        disabledReason={amount === 0n ? 'No claimable balance on this market.' : undefined}
        className="bg-yes text-black hover:bg-yes/90"
        request={() => ({
          address: pool,
          abi: foresightPoolAbi,
          functionName: 'claim' as const,
          args: [BigInt(marketId)] as const,
        })}
        onConfirmed={() => {
          void refetchPayout();
          void refetchClaimed();
        }}
      />
    </div>
  );
}
