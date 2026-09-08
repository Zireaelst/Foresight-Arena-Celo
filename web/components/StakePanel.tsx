'use client';

import {useState} from 'react';
import type {Address} from 'viem';
import {useAccount, useReadContract, useReadContracts} from 'wagmi';

import {erc20Abi, foresightPoolAbi} from '@/lib/abi.generated';
import {formatUsdc, parseUsdc} from '@/lib/format';
import {Side} from '@/lib/types';

import {TxButton} from './TxButton';

/**
 * Take a position.
 *
 * The caps are read from the pool rather than hardcoded here, and the panel shows the
 * headroom it computed before you submit. The contract enforces all of this anyway; doing
 * the arithmetic in the open just means a visitor learns the limit from the interface
 * instead of from a reverted transaction.
 */
export function StakePanel({
  pool,
  token,
  marketId,
  closed,
}: {
  pool: Address;
  token: Address;
  marketId: number;
  closed: boolean;
}) {
  const {address, isConnected} = useAccount();
  const [amount, setAmount] = useState('0.50');
  const [side, setSide] = useState<Side>(Side.Yes);

  const {data, refetch} = useReadContracts({
    contracts: [
      {address: pool, abi: foresightPoolAbi, functionName: 'MAX_STAKE_PER_POSITION'},
      {address: pool, abi: foresightPoolAbi, functionName: 'exposureCapOf', args: address ? [address] : undefined},
      {address: pool, abi: foresightPoolAbi, functionName: 'openExposure', args: address ? [address] : undefined},
      {
        address: pool,
        abi: foresightPoolAbi,
        functionName: 'stakeOf',
        args: address ? [BigInt(marketId), address, side] : undefined,
      },
      {address: token, abi: erc20Abi, functionName: 'balanceOf', args: address ? [address] : undefined},
      {address: token, abi: erc20Abi, functionName: 'allowance', args: address ? [address, pool] : undefined},
    ],
    query: {enabled: Boolean(address), refetchInterval: 10_000},
  });

  const value = <T,>(index: number, fallback: T): T =>
    (data?.[index]?.status === 'success' ? (data[index].result as T) : fallback);

  const maxPerPosition = value<bigint>(0, 1_000_000n);
  const exposureCap = value<bigint>(1, 5_000_000n);
  const openExposure = value<bigint>(2, 0n);
  const existing = value<bigint>(3, 0n);
  const balance = value<bigint>(4, 0n);
  const allowance = value<bigint>(5, 0n);

  const headroom = minOf(
    maxPerPosition > existing ? maxPerPosition - existing : 0n,
    exposureCap > openExposure ? exposureCap - openExposure : 0n,
    balance,
  );

  let parsed = 0n;
  let parseError: string | null = null;
  try {
    parsed = parseUsdc(amount);
  } catch (error) {
    parseError = (error as Error).message;
  }

  const needsApproval = parsed > allowance;
  const overHeadroom = parsed > headroom;
  const problem = parseError
    ? parseError
    : parsed === 0n
      ? 'Enter an amount above zero'
      : overHeadroom
        ? `Above your remaining headroom of ${formatUsdc(headroom, false)}`
        : undefined;

  if (closed) {
    return (
      <p className="rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-xs text-ink-faint">
        This market is closed for new positions.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {[Side.Yes, Side.No].map((s) => {
          const active = side === s;
          const yes = s === Side.Yes;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              className={`rounded-md border py-2 text-sm font-semibold transition ${
                active
                  ? yes
                    ? 'border-yes bg-yes-dim text-yes'
                    : 'border-no bg-no-dim text-no'
                  : 'border-line bg-panel-2 text-ink-dim hover:border-ink-faint'
              }`}
            >
              {yes ? 'YES' : 'NO'}
            </button>
          );
        })}
      </div>

      <label className="block">
        <span className="mb-1 block text-xs text-ink-faint">Amount</span>
        <div className="flex items-center gap-2 rounded-md border border-line bg-panel-2 px-3 focus-within:border-ink-faint">
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            className="w-full bg-transparent py-2 text-sm tnum outline-none"
            placeholder="0.50"
          />
          <button
            type="button"
            onClick={() => setAmount(formatUsdc(headroom, false))}
            className="shrink-0 text-[11px] font-medium text-accent"
          >
            MAX
          </button>
        </div>
      </label>

      {isConnected && (
        <dl className="space-y-1 text-[11px] text-ink-faint tnum">
          <Row label="Your position on this side" value={formatUsdc(existing, false)} />
          <Row label="Per-position cap" value={formatUsdc(maxPerPosition, false)} />
          <Row label="Open exposure" value={`${formatUsdc(openExposure, false)} / ${formatUsdc(exposureCap, false)}`} />
          <Row label="Available to stake now" value={formatUsdc(headroom, false)} />
        </dl>
      )}

      {needsApproval && !problem ? (
        <TxButton
          label={`Approve ${formatUsdc(parsed, false)} tUSDC`}
          pendingLabel="Approving…"
          className="bg-panel-2 text-ink hover:bg-line"
          request={() => ({
            address: token,
            abi: erc20Abi,
            functionName: 'approve' as const,
            args: [pool, parsed] as const,
          })}
          onConfirmed={() => void refetch()}
        />
      ) : (
        <TxButton
          label={`Stake ${side === Side.Yes ? 'YES' : 'NO'}`}
          pendingLabel="Staking…"
          disabled={Boolean(problem)}
          {...(problem ? {disabledReason: problem} : {})}
          className={side === Side.Yes ? 'bg-yes text-black hover:bg-yes/90' : 'bg-no text-black hover:bg-no/90'}
          request={() => ({
            address: pool,
            abi: foresightPoolAbi,
            functionName: 'stake' as const,
            args: [BigInt(marketId), side, parsed] as const,
          })}
          onConfirmed={() => void refetch()}
        />
      )}
    </div>
  );
}

function Row({label, value}: {label: string; value: string}) {
  return (
    <div className="flex justify-between gap-2">
      <dt>{label}</dt>
      <dd className="text-ink-dim">{value}</dd>
    </div>
  );
}

function minOf(...values: bigint[]): bigint {
  return values.reduce((a, b) => (a < b ? a : b));
}
