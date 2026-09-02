import type {Address, Hex} from 'viem';

import {CELO_SEPOLIA_ID, createChainContext, type ChainContext} from './chain.js';
import type {AgentBudget} from './types.js';

export interface AppConfig {
  ctx: ChainContext;
  poolAddress: Address;
  resolvers: {price: Address; chain: Address; score: Address};
  budget: AgentBudget;
  dryRun: boolean;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}. See agents/.env.example.`);
  return value;
}

function optionalAddress(name: string): Address {
  return (process.env[name]?.trim() ?? '0x0000000000000000000000000000000000000000') as Address;
}

/**
 * Testnet is the default on purpose. Reaching mainnet takes a deliberate
 * `CHAIN_ID=42220`, and the attribution guard in {@link createChainContext} will still
 * refuse if the real tag has not been set.
 */
export function loadConfig(): AppConfig {
  const chainId = Number(process.env.CHAIN_ID ?? CELO_SEPOLIA_ID);
  const rpcUrl =
    process.env.RPC_URL?.trim() ??
    (chainId === CELO_SEPOLIA_ID ? 'https://forno.celo-sepolia.celo-testnet.org' : 'https://forno.celo.org');

  return {
    ctx: createChainContext({
      chainId,
      rpcUrl,
      privateKey: required('AGENT_PRIVATE_KEY') as Hex,
      payGasInUsdc: process.env.PAY_GAS_IN_USDC !== 'false',
    }),
    poolAddress: required('FORESIGHT_POOL_ADDRESS') as Address,
    resolvers: {
      price: optionalAddress('MENTO_PRICE_RESOLVER_ADDRESS'),
      chain: optionalAddress('CHAIN_METRIC_RESOLVER_ADDRESS'),
      score: optionalAddress('ATTESTED_SCORE_RESOLVER_ADDRESS'),
    },
    budget: {
      // Mirrors ForesightPool's on-chain caps. The runner takes the smaller of the two,
      // so lowering these is safe and raising them above the contract's does nothing.
      maxStakePerPosition: BigInt(process.env.MAX_STAKE_PER_POSITION ?? 1_000_000),
      maxOpenExposure: BigInt(process.env.MAX_OPEN_EXPOSURE ?? 10_000_000),
      minConfidence: Number(process.env.MIN_CONFIDENCE ?? 0.15),
    },
    dryRun: process.env.DRY_RUN !== 'false',
  };
}
