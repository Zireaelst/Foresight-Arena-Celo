'use client';

import type {Address} from 'viem';
import {useAccount, useReadContract} from 'wagmi';

import {erc20Abi, testnetUsdcAbi} from '@/lib/abi.generated';
import {formatUsdc} from '@/lib/format';

import {TxButton} from './TxButton';

/**
 * Testnet stake tokens, self-service.
 *
 * Celo Sepolia's real USDC is a Circle FiatToken nobody can mint, so without this the
 * open half of the demo would not exist: a visitor could read the arena but never take a
 * position in it. The token is a stand-in and says so.
 */
export function FaucetCard({token}: {token: Address}) {
  const {address, isConnected} = useAccount();

  const {data: balance} = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {enabled: Boolean(address), refetchInterval: 10_000},
  });

  const {data: availableAt} = useReadContract({
    address: token,
    abi: testnetUsdcAbi,
    functionName: 'faucetAvailableAt',
    args: address ? [address] : undefined,
    query: {enabled: Boolean(address), refetchInterval: 10_000},
  });

  const coolingDown = typeof availableAt === 'bigint' && availableAt > 0n;

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-accent/25 bg-accent/[0.04] p-4 sm:flex-row sm:items-center">
      <div className="flex-1 space-y-1">
        <h2 className="text-sm font-semibold text-accent">Get testnet stake tokens</h2>
        <p className="max-w-xl text-xs leading-relaxed text-ink-dim">
          This network settles in <span className="font-mono">tUSDC</span>, a faucet-backed stand-in worth nothing.
          Tap it, then take a position on any open market. You will also need a little Celo Sepolia CELO for gas.
        </p>
        {isConnected && (
          <p className="text-xs text-ink-faint tnum">
            Your balance: {formatUsdc(typeof balance === 'bigint' ? balance : 0n, false)} tUSDC
            {coolingDown && ' · faucet cooling down'}
          </p>
        )}
      </div>

      <div className="w-full sm:w-48">
        <TxButton
          label="Tap faucet · 50 tUSDC"
          pendingLabel="Minting…"
          disabled={coolingDown}
          disabledReason={coolingDown ? 'Already tapped within the last hour.' : undefined}
          className="bg-accent text-black hover:bg-accent/90"
          request={() =>
            address
              ? {address: token, abi: testnetUsdcAbi, functionName: 'faucet' as const, args: [address] as const}
              : null
          }
        />
      </div>
    </section>
  );
}
