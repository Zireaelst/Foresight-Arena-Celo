import {createPublicClient, createWalletClient, http, type Address, type Hex, type PublicClient, type WalletClient} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {celo, celoSepolia} from 'viem/chains';

import {assertTagIsRealForMainnet, resolveAttributionTag, taggedData, readTagFromData} from './attribution.js';

export const CELO_MAINNET_ID = 42220;
export const CELO_SEPOLIA_ID = 11142220;

/**
 * Addresses mirrored from contracts/src/config/CeloAddresses.sol. If you change one,
 * change both -- the Solidity copy is what the deploy script uses.
 */
export const ADDRESSES = {
  [CELO_MAINNET_ID]: {
    usdc: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
    /** feeCurrency must be the ADAPTER for 6-decimal tokens, never the token itself. */
    usdcFeeAdapter: '0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B',
    sortedOracles: '0xefB84935239dAcdecF7c5bA76d8dE40b077B7b33',
    cusd: '0x765DE816845861e75A25fCA122bb6898B8B1282a',
    identityRegistry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    reputationRegistry: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
  },
  [CELO_SEPOLIA_ID]: {
    usdc: '0x01C5C0122039549AD1493B8220cABEdD739BC44E',
    usdcFeeAdapter: '0xbf1441Ea57f43f35f713431001f35742c88071c7',
    sortedOracles: '0xAb077999e5fA13bCda1599926F8927dDEADe533C',
    cusd: '0xEF4d55D6dE8e8d73232827Cd1e9b2F2dBb45bC80',
    identityRegistry: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    reputationRegistry: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
  },
} as const satisfies Record<number, Record<string, Address>>;

export type SupportedChainId = keyof typeof ADDRESSES;

export function isSupportedChain(id: number): id is SupportedChainId {
  return id === CELO_MAINNET_ID || id === CELO_SEPOLIA_ID;
}

export interface ChainContext {
  chainId: SupportedChainId;
  isMainnet: boolean;
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Address;
  addresses: (typeof ADDRESSES)[SupportedChainId];
  /** The ERC-8021 tag appended to every write this context sends. */
  attributionTag: string;
  /** Gas is paid in USDC via the fee adapter, so agent wallets need not hold CELO. */
  feeCurrency: Address;
}

export interface ChainContextOptions {
  chainId: number;
  rpcUrl: string;
  privateKey: Hex;
  /** Set false to pay gas in native CELO instead of USDC. */
  payGasInUsdc?: boolean;
}

export function createChainContext(options: ChainContextOptions): ChainContext {
  const {chainId, rpcUrl, privateKey, payGasInUsdc = true} = options;
  if (!isSupportedChain(chainId)) {
    throw new Error(`Unsupported chain id ${chainId}. Foresight Arena targets Celo mainnet and Celo Sepolia.`);
  }

  const attributionTag = resolveAttributionTag();
  // Fail here, at startup, rather than mid-run after money has already moved.
  assertTagIsRealForMainnet(attributionTag, chainId);

  const chain = chainId === CELO_MAINNET_ID ? celo : celoSepolia;
  const account = privateKeyToAccount(privateKey);
  const transport = http(rpcUrl);
  const addresses = ADDRESSES[chainId];

  return {
    chainId,
    isMainnet: chainId === CELO_MAINNET_ID,
    publicClient: createPublicClient({chain, transport}) as PublicClient,
    walletClient: createWalletClient({account, chain, transport}),
    account: account.address,
    addresses,
    attributionTag,
    feeCurrency: payGasInUsdc ? addresses.usdcFeeAdapter : ('0x' as Address),
  };
}

/**
 * The single exit through which every state-changing transaction leaves this codebase.
 *
 * Centralising it is what makes "every mainnet transaction carries an attribution tag"
 * an enforced property rather than a habit: the tag is appended here, verified here, and
 * there is no other send path.
 */
export async function sendTagged(
  ctx: ChainContext,
  args: {to: Address; data: Hex; value?: bigint},
): Promise<Hex> {
  assertTagIsRealForMainnet(ctx.attributionTag, ctx.chainId);

  const data = taggedData(args.data, ctx.attributionTag);

  // Cheap belt-and-braces check: decode the suffix back out before broadcasting.
  const codes = readTagFromData(data);
  if (!codes?.includes(ctx.attributionTag)) {
    throw new Error('Attribution suffix did not survive encoding; refusing to broadcast an untagged transaction.');
  }

  const request = {
    account: ctx.walletClient.account!,
    chain: ctx.walletClient.chain!,
    to: args.to,
    data,
    ...(args.value !== undefined ? {value: args.value} : {}),
    ...(ctx.feeCurrency !== '0x' ? {feeCurrency: ctx.feeCurrency} : {}),
  };

  return ctx.walletClient.sendTransaction(request as Parameters<WalletClient['sendTransaction']>[0]);
}

/**
 * Current time as the chain sees it.
 *
 * Always prefer this over `Date.now()` for anything compared against a market's
 * `closesAt` / `resolvesAt`: those are checked against `block.timestamp`, so the host's
 * wall clock is simply the wrong clock -- and on a forked or time-warped node it is not
 * even close.
 */
export async function chainNow(ctx: ChainContext): Promise<number> {
  const block = await ctx.publicClient.getBlock({blockTag: 'latest'});
  return Number(block.timestamp);
}

/** Sends and waits, returning the receipt so callers can assert on status. */
export async function sendTaggedAndWait(ctx: ChainContext, args: {to: Address; data: Hex; value?: bigint}) {
  const hash = await sendTagged(ctx, args);
  return ctx.publicClient.waitForTransactionReceipt({hash});
}
