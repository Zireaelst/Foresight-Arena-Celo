import {explorerAddress, publicClient} from '@/lib/chain';
import {foresightPoolAbi} from '@/lib/abi.generated';
import {loadAgents} from '@/lib/agents';
import {loadDeployment} from '@/lib/deployment';
import {loadMarkets} from '@/lib/markets';
import {formatUsdc, shortAddress} from '@/lib/format';
import {Outcome} from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function AgentsPage() {
  const agents = loadAgents();
  const deployment = loadDeployment();
  const markets = deployment ? (await loadMarkets()).markets : [];

  // Read each agent's ERC-8004 id from the pool rather than from the manifest: the id is
  // assigned at registration and differs per deployment, so a hardcoded one would be
  // wrong on every network but the one it was written for.
  const agentIds = await Promise.all(
    agents.map(async (agent) => {
      if (!deployment) return null;
      try {
        const id = await publicClient.readContract({
          address: deployment.foresightPool,
          abi: foresightPoolAbi,
          functionName: 'agentIdOf',
          args: [agent.wallet],
        });
        return id === 0n ? null : id.toString();
      } catch {
        return null;
      }
    }),
  );

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">The three agents</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-ink-dim">
          Each agent holds its own wallet and its own ERC-8004 identity, so its record belongs to it rather than to
          the team that wrote it. Every settled market writes a feedback entry to the Reputation Registry —
          including the losses.
        </p>
      </header>

      <div className="space-y-4">
        {agents.map((agent, index) => {
          const resolver = deployment?.[agent.resolver];
          const theirs = resolver
            ? markets.filter((m) => m.resolver.toLowerCase() === resolver.toLowerCase())
            : [];
          const settled = theirs.filter((m) => m.outcome !== Outcome.Unresolved);
          const staked = theirs.reduce((sum, m) => sum + m.yesPool + m.noPool, 0n);
          const agentId = agentIds[index] ?? agent.agentId;

          return (
            <article key={agent.slug} className="rounded-xl border border-line bg-panel p-5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-lg font-semibold">{agent.name}</h2>
                <span className="text-xs text-ink-faint">{agent.englishName}</span>
                <span className="ml-auto rounded-full bg-panel-2 px-2 py-0.5 text-[11px] text-ink-dim">
                  {agentId ? `ERC-8004 #${agentId}` : 'not yet registered'}
                </span>
              </div>

              <p className="mt-2 text-sm text-ink-dim">{agent.summary}</p>

              <dl className="mt-4 space-y-3 text-xs leading-relaxed">
                <Field label="How it decides" value={agent.method} />
                <Field label="What it trusts" value={agent.trustModel} />
                <Field label="When it refuses to stake" value={agent.passesWhen} />
              </dl>

              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line pt-3 text-xs text-ink-faint tnum">
                <a
                  href={explorerAddress(agent.wallet)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono underline"
                >
                  {shortAddress(agent.wallet)}
                </a>
                <span>{theirs.length} markets</span>
                <span>{settled.length} settled</span>
                <span>{formatUsdc(staked)} staked</span>
                <a href={`/api/agents/${agent.slug}/registration.json`} className="underline">
                  registration.json
                </a>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function Field({label, value}: {label: string; value: string}) {
  return (
    <div className="grid gap-1 sm:grid-cols-[140px_1fr] sm:gap-4">
      <dt className="text-ink-faint">{label}</dt>
      <dd className="text-ink-dim">{value}</dd>
    </div>
  );
}
