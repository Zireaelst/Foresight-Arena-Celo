import {decodeAbiParameters, type Address, type Hex} from 'viem';

import {chainNow, type ChainContext} from '../../core/chain.js';
import {Side, type ForesightAgent, type Intent, type MarketView, type Research} from '../../core/types.js';

/**
 * Zincir Nabzi -- the chain pulse.
 *
 * Forecasts questions about Celo's own state. It needs no external oracle at all: it
 * makes the exact `eth_call` that {@link ChainMetricResolver} will make at settlement,
 * then extrapolates from how the metric has moved over a recent window of blocks.
 *
 * The extrapolation is deliberately dumb -- a linear trend over a lookback window. Being
 * simple is the point: the agent's edge is supposed to come from reading real chain data,
 * not from a model nobody can audit.
 */
export class ChainPulse implements ForesightAgent {
  readonly name = 'chain-pulse';
  readonly description = "Forecasts thresholds on Celo's own on-chain metrics by reading them directly.";

  agentId?: bigint;

  /** How far back to sample when estimating the metric's trend. */
  private readonly lookbackBlocks = 5_000n;

  constructor(
    private readonly ctx: ChainContext,
    private readonly resolverAddress: Address,
  ) {}

  isInScope(market: MarketView): boolean {
    return market.resolver.toLowerCase() === this.resolverAddress.toLowerCase();
  }

  async research(market: MarketView): Promise<Research> {
    const config = decodeConfig(market.resolverConfig);
    const [latest, now] = await Promise.all([this.ctx.publicClient.getBlockNumber(), chainNow(this.ctx)]);
    const past = latest > this.lookbackBlocks ? latest - this.lookbackBlocks : 0n;

    const [current, previous] = await Promise.all([
      this.readMetric(config.target, config.callData),
      this.readMetric(config.target, config.callData, past),
    ]);

    const sources = [
      `celo:${this.ctx.chainId}/eth_call ${config.target} ${config.callData} @block ${latest}`,
      `same call @block ${past} for the trend baseline`,
    ];

    if (current === null) {
      return {
        marketId: market.id,
        probabilityYes: 0.5,
        confidence: 0,
        rationale: 'The metric call does not return a single word right now; this market is likely to void.',
        sources,
      };
    }

    const projected = this.project(current, previous, latest, past, market.resolvesAt, now);
    const clearsNow = config.comparator === Comparator.AtOrAbove
      ? projected >= config.threshold
      : projected <= config.threshold;

    const margin = relativeMargin(projected, config.threshold);
    const confidence = clampUnit(margin / 0.05);

    return {
      marketId: market.id,
      probabilityYes: clearsNow ? 0.5 + confidence / 2 : 0.5 - confidence / 2,
      confidence,
      rationale:
        `Metric is ${current} now (was ${previous ?? 'unknown'} ${this.lookbackBlocks} blocks ago); ` +
        `projected ${projected} at settlement, ${(margin * 100).toFixed(2)}% ` +
        `${clearsNow ? 'past' : 'short of'} the threshold ${config.threshold}.`,
      sources,
    };
  }

  async position(market: MarketView, research: Research): Promise<Intent> {
    if (research.confidence <= 0) {
      return {kind: 'pass', marketId: market.id, reason: research.rationale};
    }
    const side = research.probabilityYes >= 0.5 ? Side.Yes : Side.No;
    return {kind: 'stake', marketId: market.id, side, amount: BigInt(Math.round(research.confidence * 1e6)), research};
  }

  // ---------------------------------------------------------------------

  private async readMetric(target: Address, callData: Hex, blockNumber?: bigint): Promise<bigint | null> {
    try {
      const {data} = await this.ctx.publicClient.call({
        to: target,
        data: callData,
        ...(blockNumber !== undefined ? {blockNumber} : {}),
      });
      // 0x + 64 hex characters is exactly one word, which is what the resolver requires.
      if (!data || data.length !== 66) return null;
      return BigInt(data);
    } catch {
      return null;
    }
  }

  /** Linear extrapolation of the metric to settlement time, using ~5s Celo blocks. */
  private project(
    current: bigint,
    previous: bigint | null,
    latest: bigint,
    past: bigint,
    resolvesAt: number,
    now: number,
  ): bigint {
    if (previous === null || latest === past) return current;

    const secondsAhead = BigInt(Math.max(0, resolvesAt - now));
    const blocksAhead = secondsAhead / 5n;
    const delta = current - previous;
    const elapsed = latest - past;
    return current + (delta * blocksAhead) / elapsed;
  }
}

// -- resolver config decoding ------------------------------------------

enum Comparator {
  AtOrAbove = 0,
  AtOrBelow = 1,
}

const CONFIG_ABI = [
  {
    type: 'tuple',
    components: [
      {name: 'target', type: 'address'},
      {name: 'callData', type: 'bytes'},
      {name: 'threshold', type: 'uint256'},
      {name: 'comparator', type: 'uint8'},
    ],
  },
] as const;

function decodeConfig(data: Hex) {
  const [config] = decodeAbiParameters(CONFIG_ABI, data);
  return {
    target: config.target,
    callData: config.callData,
    threshold: config.threshold,
    comparator: config.comparator as Comparator,
  };
}

function relativeMargin(value: bigint, threshold: bigint): number {
  if (threshold === 0n) return 0;
  const diff = value > threshold ? value - threshold : threshold - value;
  return Number((diff * 10_000n) / threshold) / 10_000;
}

function clampUnit(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}
