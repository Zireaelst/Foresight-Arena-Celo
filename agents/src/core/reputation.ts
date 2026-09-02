import {encodeFunctionData, keccak256, toHex, type Address} from 'viem';

import {reputationRegistryAbi} from './abi.js';
import {sendTaggedAndWait, type ChainContext} from './chain.js';
import {Outcome, type SettlementReport} from './types.js';

/**
 * ERC-8004 reputation writes.
 *
 * The loop's last step. An agent that only reported its own wins would be worthless, so
 * every settled market produces a feedback entry regardless of whether the agent was
 * right -- the score is the public record, not a highlight reel.
 *
 * Reputation Registry (verified deployed on both networks):
 *   mainnet  0x8004BAa17C55a88189AE136b182e5fdA19dE9b63
 *   sepolia  0x8004B663056A597Dffe9eCcC1965A193B7388713
 *
 * The ERC-8004 SDK surface is still moving; this uses the raw registry ABI on purpose so
 * the project does not depend on a third-party wrapper.
 */

/** Feedback is written on a 0-100 scale with two decimals, i.e. valueDecimals = 2. */
const VALUE_DECIMALS = 2;

export interface FeedbackRecord {
  agentId: bigint;
  /** Score in [0, 100]. */
  score: number;
  marketId: bigint;
  outcome: Outcome;
  calledCorrectly: boolean;
  payout: bigint;
  staked: bigint;
  rationale: string;
  sources: string[];
}

/**
 * Turns a settlement into a score.
 *
 * A voided market is not evidence about an agent's judgement in either direction, so it
 * is scored neutrally rather than counted as a loss.
 */
export function scoreFromSettlement(report: SettlementReport): number {
  if (report.outcome === Outcome.Void) return 50;
  return report.calledCorrectly ? 100 : 0;
}

/** Canonical JSON for the off-chain feedback document, hashed on-chain. */
export function buildFeedbackPayload(record: FeedbackRecord): string {
  return JSON.stringify({
    schema: 'foresight-arena/feedback/1',
    agentId: record.agentId.toString(),
    marketId: record.marketId.toString(),
    outcome: Outcome[record.outcome],
    calledCorrectly: record.calledCorrectly,
    staked: record.staked.toString(),
    payout: record.payout.toString(),
    score: record.score,
    rationale: record.rationale,
    sources: record.sources,
  });
}

export class ReputationClient {
  constructor(
    private readonly ctx: ChainContext,
    readonly registry: Address = ctx.addresses.reputationRegistry,
  ) {}

  /**
   * @param feedbackURI Where the payload is published (IPFS or an HTTPS mirror). May be
   *        empty while the dashboard is not yet hosting it -- the hash is the binding part.
   */
  async giveFeedback(record: FeedbackRecord, feedbackURI = ''): Promise<{payload: string; hash: `0x${string}`}> {
    const payload = buildFeedbackPayload(record);
    const hash = keccak256(toHex(payload));

    const clamped = Math.max(0, Math.min(100, record.score));
    const value = BigInt(Math.round(clamped * 10 ** VALUE_DECIMALS));

    await sendTaggedAndWait(this.ctx, {
      to: this.registry,
      data: encodeFunctionData({
        abi: reputationRegistryAbi,
        functionName: 'giveFeedback',
        args: [
          record.agentId,
          value,
          VALUE_DECIMALS,
          'foresight-arena',
          Outcome[record.outcome].toLowerCase(),
          `market:${record.marketId}`,
          feedbackURI,
          hash,
        ],
      }),
    });

    return {payload, hash};
  }

  async summary(agentId: bigint, clients: Address[] = []) {
    const [count, summaryValue, decimals] = await this.ctx.publicClient.readContract({
      address: this.registry,
      abi: reputationRegistryAbi,
      functionName: 'getSummary',
      args: [agentId, clients, 'foresight-arena', ''],
    });
    return {count, summaryValue, decimals};
  }
}
