import type {Address} from 'viem';
import {parseAbiItem} from 'viem';

import {explorerAddress, publicClient} from '@/lib/chain';
import {formatUsdc, shortAddress} from '@/lib/format';
import {Side} from '@/lib/types';

const STAKED_EVENT = parseAbiItem(
  'event Staked(uint256 indexed marketId, address indexed account, uint8 side, uint256 amount)',
);

/** How far back to scan. Public RPCs cap log ranges, and a market's life is short. */
const LOOKBACK_BLOCKS = 100_000n;

/**
 * Who took which side, from the chain's own event log.
 *
 * This is the part that makes the project's central claim checkable rather than merely
 * stated: the agents' positions are public, timestamped, and attributable to a wallet
 * whose whole history anyone can pull up.
 */
export async function StakeLog({pool, marketId}: {pool: Address; marketId: number}) {
  const entries = await readStakes(pool, marketId);

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">Positions taken</h2>
      {entries === null ? (
        <p className="rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-xs text-ink-faint">
          Could not read the event log from this RPC endpoint.
        </p>
      ) : entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-xs text-ink-faint">
          Nobody has staked on this market yet.
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
          {entries.map((entry) => (
            <li key={`${entry.hash}-${entry.logIndex}`} className="flex items-center gap-3 px-3 py-2 text-xs">
              <span
                className={`w-9 shrink-0 rounded px-1.5 py-0.5 text-center font-semibold ${
                  entry.side === Side.Yes ? 'bg-yes-dim text-yes' : 'bg-no-dim text-no'
                }`}
              >
                {entry.side === Side.Yes ? 'YES' : 'NO'}
              </span>
              <a
                href={explorerAddress(entry.account)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-ink-dim underline"
              >
                {shortAddress(entry.account)}
              </a>
              <span className="ml-auto tnum text-ink">{formatUsdc(entry.amount, false)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function readStakes(pool: Address, marketId: number) {
  try {
    const latest = await publicClient.getBlockNumber();
    const logs = await publicClient.getLogs({
      address: pool,
      event: STAKED_EVENT,
      args: {marketId: BigInt(marketId)},
      fromBlock: latest > LOOKBACK_BLOCKS ? latest - LOOKBACK_BLOCKS : 0n,
      toBlock: latest,
    });

    return logs.map((log) => ({
      account: log.args.account as Address,
      side: Number(log.args.side) as Side,
      amount: log.args.amount as bigint,
      hash: log.transactionHash,
      logIndex: log.logIndex,
    }));
  } catch {
    // A missing log history is a degraded view, not a broken page: everything else on
    // this screen comes from contract state and is still correct.
    return null;
  }
}
