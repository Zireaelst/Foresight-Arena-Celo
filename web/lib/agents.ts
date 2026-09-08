import 'server-only';

import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import type {Address} from 'viem';

export interface AgentProfile {
  slug: string;
  name: string;
  englishName: string;
  wallet: Address;
  agentId: string | null;
  resolver: 'mentoPriceResolver' | 'chainMetricResolver' | 'attestedScoreResolver';
  summary: string;
  method: string;
  trustModel: string;
  passesWhen: string;
}

/**
 * The showcase agents, from `shared/agents.json`.
 *
 * Shared with the agent runtime rather than duplicated here, so the wallet a visitor sees
 * on this dashboard is provably the wallet the agent actually stakes from.
 */
export function loadAgents(): AgentProfile[] {
  // Synced from shared/agents.json at build time -- see scripts/sync-data.mjs.
  const path = join(process.cwd(), 'data', 'agents.json');
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as {agents?: AgentProfile[]};
  return parsed.agents ?? [];
}

export function findAgent(slug: string): AgentProfile | undefined {
  return loadAgents().find((agent) => agent.slug === slug);
}
