import Link from 'next/link';
import {notFound} from 'next/navigation';

import {OutcomePill} from '@/components/OutcomePill';
import {PoolBar} from '@/components/PoolBar';
import {SettlePanel} from '@/components/SettlePanel';
import {StakePanel} from '@/components/StakePanel';
import {StakeLog} from '@/components/StakeLog';
import {explorerAddress} from '@/lib/chain';
import {formatPercent, formatUsdc, formatUtc, impliedYes, relativeTime, shortAddress} from '@/lib/format';
import {AGENT_FOR_KIND, loadMarket} from '@/lib/markets';
import {OUTCOME_LABEL, Outcome, PHASE_LABEL, phaseOf} from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function MarketPage({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  const parsed = Number(id);
  if (!Number.isInteger(parsed) || parsed < 0) notFound();

  const loaded = await loadMarket(parsed);
  if (!loaded) notFound();

  const {market, deployment, chainNow} = loaded;
  const phase = phaseOf(market, chainNow);
  const agent = AGENT_FOR_KIND[market.kind];
  const total = market.yesPool + market.noPool;
  const implied = impliedYes(market.yesPool, market.noPool);
  // Distinguish "nobody yet" from "one side only": both settle to Void, but they ask
  // different things of a reader -- one is an invitation, the other is a warning.
  const unsettled = market.outcome === Outcome.Unresolved;
  const empty = unsettled && market.yesPool === 0n && market.noPool === 0n;
  const oneSided = unsettled && !empty && (market.yesPool === 0n || market.noPool === 0n);

  return (
    <div className="space-y-6">
      <Link href="/" className="inline-block text-xs text-ink-faint hover:text-ink-dim">
        ← All markets
      </Link>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <header className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{agent.name}</span>
              <OutcomePill market={market} now={chainNow} />
            </div>
            <h1 className="text-xl leading-snug font-semibold">{market.question}</h1>
            <p className="max-w-2xl text-xs leading-relaxed text-ink-faint">{agent.blurb}</p>
          </header>

          <section className="rounded-xl border border-line bg-panel p-4">
            <PoolBar yesPool={market.yesPool} noPool={market.noPool} />
            <div className="mt-3 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <Stat label="Total staked" value={formatUsdc(total, false)} />
              <Stat label="Implied YES" value={formatPercent(implied)} />
              <Stat
                label="If YES wins"
                value={market.yesPool === 0n ? '—' : `${(Number(total) / Number(market.yesPool)).toFixed(2)}×`}
              />
              <Stat
                label="If NO wins"
                value={market.noPool === 0n ? '—' : `${(Number(total) / Number(market.noPool)).toFixed(2)}×`}
              />
            </div>
          </section>

          {empty && (
            <p className="rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-xs leading-relaxed text-ink-dim">
              Nobody has taken a position yet. If both sides are still empty at settlement the market voids and
              nothing changes hands. {market.kind === 'score' && (
                <>The agent has deliberately passed on this one: it does not forecast unplayed fixtures, only
                reports finished ones its sources agree on. The question is open to anyone who wants to.</>
              )}
            </p>
          )}

          {oneSided && (
            <p className="rounded-lg border border-accent/30 bg-accent/[0.05] px-3 py-2.5 text-xs leading-relaxed text-accent">
              Only one side is staked. If it stays that way, this market settles as <strong>Void</strong> and
              everyone is refunded — a lone staker took no counterparty risk, so there is nothing to win.
            </p>
          )}

          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">How this settles</h2>
            <p className="rounded-lg border border-line bg-panel-2 px-3 py-2.5 font-mono text-xs leading-relaxed text-ink-dim">
              {market.description}
            </p>
            <p className="text-xs leading-relaxed text-ink-faint">
              Read from the resolver contract itself at{' '}
              <a href={explorerAddress(market.resolver)} target="_blank" rel="noreferrer" className="underline">
                {shortAddress(market.resolver)}
              </a>
              . Settlement is a contract call anyone can make — there is no arbiter and no appeal. If the data source
              cannot decide, the market voids and every stake is refunded.
            </p>
          </section>

          <StakeLog pool={deployment.foresightPool} marketId={market.id} />
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <div className="space-y-3 rounded-xl border border-line bg-panel p-4">
            <h2 className="text-sm font-semibold">
              {market.outcome === Outcome.Unresolved ? 'Take a position' : OUTCOME_LABEL[market.outcome]}
            </h2>

            {market.outcome === Outcome.Unresolved && (
              <StakePanel
                pool={deployment.foresightPool}
                token={deployment.stakeToken}
                marketId={market.id}
                closed={phase !== 'open'}
              />
            )}

            {(phase === 'settleable' || market.outcome !== Outcome.Unresolved) && (
              <div className="border-t border-line pt-3">
                <SettlePanel
                  pool={deployment.foresightPool}
                  marketId={market.id}
                  outcome={market.outcome}
                  settleable={phase === 'settleable'}
                />
              </div>
            )}
          </div>

          <dl className="space-y-2 rounded-xl border border-line bg-panel p-4 text-xs">
            <Meta label="Status" value={PHASE_LABEL[phase]} />
            <Meta label="Closes" value={`${formatUtc(market.closesAt)} · ${relativeTime(market.closesAt, chainNow)}`} />
            <Meta
              label="Settles from"
              value={`${formatUtc(market.resolvesAt)} · ${relativeTime(market.resolvesAt, chainNow)}`}
            />
            <Meta label="Opened by" value={shortAddress(market.creator)} href={explorerAddress(market.creator)} />
            <Meta label="Resolver" value={shortAddress(market.resolver)} href={explorerAddress(market.resolver)} />
            <Meta label="Market id" value={`#${market.id}`} />
          </dl>
        </aside>
      </div>
    </div>
  );
}

function Stat({label, value}: {label: string; value: string}) {
  return (
    <div>
      <div className="text-[11px] text-ink-faint">{label}</div>
      <div className="tnum text-base font-medium">{value}</div>
    </div>
  );
}

function Meta({label, value, href}: {label: string; value: string; href?: string}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-faint">{label}</dt>
      <dd className="text-right text-ink-dim">
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" className="font-mono underline">
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
