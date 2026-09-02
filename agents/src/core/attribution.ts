import {toDataSuffix, fromDataSuffix, verifyTx} from '@celo/attribution-tags';
import type {Hex} from 'viem';

/**
 * ERC-8021 attribution tagging.
 *
 * Hackathon rule, restated because getting it wrong costs everything: a Celo mainnet
 * transaction without an attribution tag does not appear on the leaderboard at all. So
 * every write this project makes goes through {@link taggedData}, and mainnet refuses to
 * run at all while the tag is still a placeholder.
 *
 * The real tag (`celo_` + 12 hex) is issued by celobuilders at registration and is
 * derived from the GitHub `owner/repo` slug, then locked on first save. Until we have
 * registered, `PLACEHOLDER_TAG` stands in so the plumbing can be built and tested on
 * Celo Sepolia.
 */

/** Not a real tag. Testnet only -- see {@link assertTagIsRealForMainnet}. */
export const PLACEHOLDER_TAG = 'celo_000000000000' as const;

const TAG_PATTERN = /^celo_[0-9a-f]{12}$/;

export class AttributionError extends Error {}

export function isWellFormedTag(tag: string): boolean {
  return TAG_PATTERN.test(tag);
}

export function isPlaceholder(tag: string): boolean {
  return tag === PLACEHOLDER_TAG;
}

/**
 * Reads the tag from the environment, falling back to the placeholder.
 * Throws on a malformed tag rather than silently sending untagged-looking transactions.
 */
export function resolveAttributionTag(env: NodeJS.ProcessEnv = process.env): string {
  const tag = env.ATTRIBUTION_TAG?.trim();
  if (!tag) return PLACEHOLDER_TAG;
  if (!isWellFormedTag(tag)) {
    throw new AttributionError(
      `ATTRIBUTION_TAG "${tag}" is malformed: expected "celo_" followed by 12 lowercase hex characters.`,
    );
  }
  return tag;
}

/**
 * The guard that keeps a placeholder tag off mainnet. Called by the chain layer before
 * any mainnet write; a tagless or placeholder-tagged mainnet transaction is worse than
 * no transaction, because it spends real money and scores nothing.
 */
export function assertTagIsRealForMainnet(tag: string, chainId: number): void {
  const MAINNET = 42220;
  if (chainId !== MAINNET) return;
  if (isPlaceholder(tag)) {
    throw new AttributionError(
      'Refusing to send a Celo mainnet transaction with the placeholder attribution tag. ' +
        'Register at https://celobuilders.xyz to receive the real tag, then set ATTRIBUTION_TAG.',
    );
  }
  if (!isWellFormedTag(tag)) {
    throw new AttributionError(`Refusing to send a mainnet transaction with malformed tag "${tag}".`);
  }
}

/**
 * Appends the ERC-8021 data suffix to calldata.
 *
 * Safe for the pool's functions: Solidity ignores trailing calldata for non-fallback
 * external functions, so the suffix rides along without disturbing ABI decoding.
 */
export function taggedData(data: Hex, tag: string): Hex {
  const suffix = toDataSuffix(tag);
  return (data + suffix.slice(2)) as Hex;
}

/** Reads a tag back out of calldata, for local assertions before broadcasting. */
export function readTagFromData(data: Hex): string[] | null {
  const decoded = fromDataSuffix(data);
  return decoded ? decoded.codes : null;
}

export {verifyTx};
