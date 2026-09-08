import {celo, celoSepolia} from 'viem/chains';
import {createPublicClient, http, type PublicClient} from 'viem';

export const CELO_MAINNET_ID = 42220;
export const CELO_SEPOLIA_ID = 11142220;

/** Testnet is the default here for the same reason it is in the agent layer: reaching
 *  mainnet should take a deliberate act, not a forgotten environment variable. */
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? CELO_SEPOLIA_ID);

export const chain = CHAIN_ID === CELO_MAINNET_ID ? celo : celoSepolia;

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ??
  (CHAIN_ID === CELO_MAINNET_ID
    ? 'https://forno.celo.org'
    : 'https://forno.celo-sepolia.celo-testnet.org');

/** Server-side reader. The dashboard renders market state from chain on every request
 *  rather than from a cache, so what a visitor sees is what a staker would transact
 *  against. */
export const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL),
}) as PublicClient;

export const isTestnet = CHAIN_ID !== CELO_MAINNET_ID;

export function explorerTx(hash: string): string {
  return `${chain.blockExplorers?.default.url ?? ''}/tx/${hash}`;
}

export function explorerAddress(address: string): string {
  return `${chain.blockExplorers?.default.url ?? ''}/address/${address}`;
}
