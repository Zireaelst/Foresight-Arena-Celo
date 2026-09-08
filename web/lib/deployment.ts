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
    // Synced into web/data by scripts/sync-data.mjs at build time, so the dashboard
    // never reaches outside its own directory at request time.
    const path = join(process.cwd(), 'data', `${CHAIN_ID}.json`);
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
      `No deployment found for chain ${CHAIN_ID}. Deploy the contract layer first ` +
        '(scripts/deploy-testnet.sh), then `npm run sync-data` here.',
    );
  }
  return deployment;
}
