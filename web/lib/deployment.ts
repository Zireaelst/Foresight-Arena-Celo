import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import type {Address} from 'viem';

import {CHAIN_ID} from './chain';

export interface Deployment {
  chainId: number;
  owner: Address;
  stakeToken: Address;
  priceFeed: Address;
  scoreAttestor: Address;
  foresightPool: Address;
  mentoPriceResolver: Address;
  chainMetricResolver: Address;
  attestedScoreResolver: Address;
}

/**
 * Reads the addresses the deploy script wrote.
 *
 * Deliberately sourced from `contracts/deployments/<chainId>.json` rather than from
 * environment variables: that file is produced by the deployment itself, so the dashboard
 * cannot quietly point at a stale pool because somebody forgot to update a secret.
 */
export function loadDeployment(): Deployment | null {
  try {
    const path = join(process.cwd(), '..', 'contracts', 'deployments', `${CHAIN_ID}.json`);
    return JSON.parse(readFileSync(path, 'utf8')) as Deployment;
  } catch {
    return null;
  }
}

/** Throws with an actionable message; use in routes that cannot render without addresses. */
export function requireDeployment(): Deployment {
  const deployment = loadDeployment();
  if (!deployment) {
    throw new Error(
      `No deployment found for chain ${CHAIN_ID}. Run the deploy script in contracts/ first ` +
        '(see contracts/README.md).',
    );
  }
  return deployment;
}
