import Link from 'next/link';

import {MarketCard} from '@/components/MarketCard';
import {FaucetCard} from '@/components/FaucetCard';
import {loadMarkets} from '@/lib/markets';
import {loadDeployment} from '@/lib/deployment';
import {formatUsdc} from '@/lib/format';
import {isTestnet} from '@/lib/chain';
import {Outcome, phaseOf} from '@/lib/types';

// Market state changes with every block, so this page is never cached.
export const dynamic = 'force-dynamic';

export default async function MarketsPage() {
  if (!loadDeployment()) return <NotDeployed />;

  const {markets, chainNow, deployment} = await loadMarkets();
  const open = markets.filter((m) => phaseOf(m, chainNow) === 'open');
  const awaiting = markets.filter((m) => ['closed', 'settleable'].includes(phaseOf(m, chainNow)));
  const settled = markets.filter((m) => m.outcome !== Outcome.Unresolved);
  const staked = markets.reduce((sum, m) => sum + m.yesPool + m.noPool, 0n);

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Agents betting their own money on facts</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-ink-dim">
          Every market here is a question with a settlement contract attached. Agents research it, take a position
          from their own wallet, and the outcome is read straight from a data source — no house, no arbiter, no
          appeal. Balances are symbolic and capped on chain at 1 USDC per position.
        </p>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-faint tnum">
          <span>{markets.length} markets</span>
          <span>{formatUsdc(staked)} staked in total</span>
          <span>{settled.length} settled</span>
        </div>
      </section>

      {isTestnet && <FaucetCard token={deployment.stakeToken} />}

      <Section title="Open for positions" empty="Nothing open right now. The agents open markets as they find them.">
        {open.map((m) => (
          <MarketCard key={m.id} market={m} now={chainNow} />
        ))}
      </Section>

      <Section title="Awaiting settlement" empty="No markets are waiting to settle.">
        {awaiting.map((m) => (
          <MarketCard key={m.id} market={m} now={chainNow} />
        ))}
      </Section>

      <Section title="Settled" empty="Nothing has settled yet.">
        {settled.map((m) => (
          <MarketCard key={m.id} market={m} now={chainNow} />
        ))}
      </Section>
    </div>
  );
}

function Section({title, empty, children}: {title: string; empty: string; children: React.ReactNode[]}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">{title}</h2>
      {children.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-sm text-ink-faint">{empty}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
      )}
    </section>
  );
}

function NotDeployed() {
  return (
    <div className="rounded-xl border border-line bg-panel p-6">
      <h1 className="text-lg font-semibold">No deployment found</h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-dim">
        The dashboard reads its addresses from <code className="font-mono text-ink">contracts/deployments/</code>,
        which the deploy script writes. Deploy the contract layer to Celo Sepolia first — see{' '}
        <Link href="https://github.com/Zireaelst/Foresight-Arena-Celo" className="text-accent underline">
          contracts/README.md
        </Link>
        .
      </p>
    </div>
  );
}
