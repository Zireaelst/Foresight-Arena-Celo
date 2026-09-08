import type {Hex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';

import {CELO_SEPOLIA_ID, createChainContext, type ChainContext} from '../core/chain.js';

/**
 * The wallet roles this deployment uses.
 *
 * Each agent holds its own key on purpose: an ERC-8004 identity shared between agents
 * would make the reputation record meaningless.
 *
 * `scorekeeper` is separate from all of them because the Reputation Registry rejects
 * self-feedback ("Self-feedback not allowed"), so an agent physically cannot write its
 * own score -- which is the right rule, and the reason the writing is a distinct job.
 */
export type Role = 'deployer' | 'scorekeeper' | 'price-sentinel' | 'chain-pulse' | 'score-oracle';

const ENV_VAR: Record<Role, string> = {
  deployer: 'DEPLOYER_PRIVATE_KEY',
  scorekeeper: 'SCOREKEEPER_PRIVATE_KEY',
  'price-sentinel': 'PRICE_SENTINEL_PRIVATE_KEY',
  'chain-pulse': 'CHAIN_PULSE_PRIVATE_KEY',
  'score-oracle': 'SCORE_ORACLE_PRIVATE_KEY',
};

export function privateKeyFor(role: Role): Hex {
  const key = process.env[ENV_VAR[role]]?.trim();
  if (!key) throw new Error(`Missing ${ENV_VAR[role]} in the environment. See agents/.env.example.`);
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(`${ENV_VAR[role]} is not a 32-byte hex private key.`);
  return key as Hex;
}

export function addressFor(role: Role): `0x${string}` {
  return privateKeyToAccount(privateKeyFor(role)).address;
}

/** A chain context bound to one role's wallet. Writes still go through `sendTagged`. */
export function contextFor(role: Role): ChainContext {
  return createChainContext({
    chainId: Number(process.env.CHAIN_ID ?? CELO_SEPOLIA_ID),
    rpcUrl:
      process.env.RPC_URL?.trim() ??
      (Number(process.env.CHAIN_ID ?? CELO_SEPOLIA_ID) === CELO_SEPOLIA_ID
        ? 'https://forno.celo-sepolia.celo-testnet.org'
        : 'https://forno.celo.org'),
    privateKey: privateKeyFor(role),
    payGasInUsdc: process.env.PAY_GAS_IN_USDC === 'true',
  });
}

export function requireAddress(name: string): `0x${string}` {
  const value = process.env[name]?.trim();
  if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Missing or malformed ${name}. Run the deploy script first.`);
  }
  return value as `0x${string}`;
}

export const AGENT_ROLES: Role[] = ['price-sentinel', 'chain-pulse', 'score-oracle'];
