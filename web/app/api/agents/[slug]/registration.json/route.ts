import {NextResponse} from 'next/server';

import {CHAIN_ID} from '@/lib/chain';
import {loadDeployment} from '@/lib/deployment';
import {findAgent} from '@/lib/agents';

/**
 * The ERC-8004 registration document an agent's `agentURI` points at.
 *
 * The Identity Registry stores only a URI, so this is where an agent says what it is,
 * which wallet it acts from, and — the part that matters for a project about verifiable
 * claims — what it will and will not stake on. Served from the same manifest the runtime
 * uses, so it cannot describe an agent that does not exist.
 */
export async function GET(_request: Request, {params}: {params: Promise<{slug: string}>}) {
  const {slug} = await params;
  const agent = findAgent(slug);
  if (!agent) return NextResponse.json({error: `Unknown agent "${slug}"`}, {status: 404});

  const deployment = loadDeployment();

  return NextResponse.json(
    {
      type: 'https://eips.ethereum.org/EIPS/eip-8004#registration',
      name: agent.englishName,
      alternateName: agent.name,
      description: agent.summary,
      wallet: agent.wallet,
      chainId: CHAIN_ID,
      capabilities: {
        domain: 'forecasting',
        questionTypes: ['objective', 'data-settled'],
        method: agent.method,
        abstainsWhen: agent.passesWhen,
      },
      trustModels: agent.trustModel.startsWith('Fully on-chain')
        ? ['crypto-economic', 'on-chain-verifiable']
        : ['crypto-economic', 'multi-source-attestation'],
      contracts: deployment
        ? {
            foresightPool: deployment.foresightPool,
            resolver: deployment[agent.resolver],
            stakeToken: deployment.stakeToken,
          }
        : null,
      feedback: {
        registry: 'ERC-8004 Reputation Registry',
        tag: 'foresight-arena',
        note: 'Every settled market produces a feedback entry, including losses. The record is not a highlight reel.',
      },
    },
    {headers: {'cache-control': 'public, max-age=60'}},
  );
}
