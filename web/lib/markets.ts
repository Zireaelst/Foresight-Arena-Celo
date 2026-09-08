import 'server-only';

import type {Address} from 'viem';

import {foresightPoolAbi, outcomeResolverAbi} from './abi.generated';
import {publicClient} from './chain';
import {requireDeployment, type Deployment} from './deployment';
import {Outcome, type Market} from './types';

/**
 * Reads every market from the pool, plus each resolver's own description of how it will
 * settle.
 *
 * The description comes from `IOutcomeResolver.describe` rather than from anything stored
 * here, which is the point: a visitor reads the settlement rule from the contract that
 * will actually apply it, not from marketing copy the dashboard could get wrong.
 */
export async function loadMarkets(): Promise<{markets: Market[]; deployment: Deployment; chainNow: number}> {
  const deployment = requireDeployment();
  const pool = deployment.foresightPool;

  const [count, block] = await Promise.all([
    publicClient.readContract({address: pool, abi: foresightPoolAbi, functionName: 'marketCount'}),
    publicClient.getBlock({blockTag: 'latest'}),
  ]);

  const ids = Array.from({length: Number(count)}, (_, i) => BigInt(i));
  const raw = await Promise.all(
    ids.map((id) =>
      publicClient.readContract({address: pool, abi: foresightPoolAbi, functionName: 'getMarket', args: [id]}),
    ),
  );

  const markets = await Promise.all(
    raw.map(async (m, index) => {
      const description = await describe(m.resolver, m.resolverConfig);
      return {
        id: index,
        creator: m.creator,
        resolver: m.resolver,
        closesAt: Number(m.closesAt),
        resolvesAt: Number(m.resolvesAt),
        outcome: m.outcome as Outcome,
        yesPool: m.yesPool,
        noPool: m.noPool,
        question: m.question,
        resolverConfig: m.resolverConfig,
        description,
        kind: kindOf(m.resolver, deployment),
      } satisfies Market;
    }),
  );

  // Newest first: an arena where the interesting thing is what just opened.
  markets.reverse();
  return {markets, deployment, chainNow: Number(block.timestamp)};
}

export async function loadMarket(id: number): Promise<{market: Market; deployment: Deployment; chainNow: number} | null> {
  const {markets, deployment, chainNow} = await loadMarkets();
  const market = markets.find((m) => m.id === id);
  return market ? {market, deployment, chainNow} : null;
}

/** A resolver that cannot describe itself is not a reason to fail the page. */
async function describe(resolver: Address, config: `0x${string}`): Promise<string> {
  try {
    return await publicClient.readContract({
      address: resolver,
      abi: outcomeResolverAbi,
      functionName: 'describe',
      args: [config],
    });
  } catch {
    return 'This resolver did not return a description for the market configuration.';
  }
}

function kindOf(resolver: Address, d: Deployment): Market['kind'] {
  const at = resolver.toLowerCase();
  if (at === d.mentoPriceResolver.toLowerCase()) return 'price';
  if (at === d.chainMetricResolver.toLowerCase()) return 'chain';
  if (at === d.attestedScoreResolver.toLowerCase()) return 'score';
  return 'unknown';
}

export const AGENT_FOR_KIND: Record<Market['kind'], {name: string; slug: string; blurb: string}> = {
  price: {
    name: 'Fiyat Nöbetçisi',
    slug: 'price-sentinel',
    blurb: 'Reads the same oracle median the resolver will settle against, so it forecasts drift, not price.',
  },
  chain: {
    name: 'Zincir Nabzı',
    slug: 'chain-pulse',
    blurb: "Makes the exact eth_call settlement will make, then extrapolates from recent blocks.",
  },
  score: {
    name: 'Skor Kahini',
    slug: 'score-oracle',
    blurb: 'Reports fixtures only when independent public score APIs agree on the exact scoreline.',
  },
  unknown: {name: 'Unknown resolver', slug: '', blurb: 'This market points at a resolver the dashboard does not know.'},
};
