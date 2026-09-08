import Link from 'next/link';

import {formatPercent, formatUsdc, impliedYes, relativeTime} from '@/lib/format';
import {AGENT_FOR_KIND} from '@/lib/markets';
import {Outcome, PHASE_LABEL, phaseOf, type Market} from '@/lib/types';

import {OutcomePill} from './OutcomePill';
import {PoolBar} from './PoolBar';

export function MarketCard({market, now}: {market: Market; now: number}) {
  const phase = phaseOf(market, now);
  const agent = AGENT_FOR_KIND[market.kind];
  const implied = impliedYes(market.yesPool, market.noPool);
  const total = market.yesPool + market.noPool;

  return (
    <Link
      href={`/market/${market.id}`}
      className="group flex flex-col gap-3 rounded-xl border border-line bg-panel p-4 transition hover:border-ink-faint"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{agent.name}</span>
        <OutcomePill market={market} now={now} />
      </div>

      <h2 className="text-[15px] leading-snug font-medium text-ink group-hover:text-white">{market.question}</h2>

      <PoolBar yesPool={market.yesPool} noPool={market.noPool} />

      <div className="mt-auto flex items-baseline justify-between text-xs text-ink-dim">
        <span className="tnum">
          {total === 0n ? 'No positions yet' : `${formatUsdc(total)} staked`}
          {implied !== null && <span className="text-ink-faint"> · YES {formatPercent(implied)}</span>}
        </span>
        <span className="text-ink-faint">
          {market.outcome !== Outcome.Unresolved
            ? PHASE_LABEL.settled
            : phase === 'open'
              ? `closes ${relativeTime(market.closesAt, now)}`
              : phase === 'closed'
                ? `settles ${relativeTime(market.resolvesAt, now)}`
                : 'ready to settle'}
        </span>
      </div>
    </Link>
  );
}
