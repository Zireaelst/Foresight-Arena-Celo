import {decodeAbiParameters, type Address} from 'viem';

import {mentoPriceResolverAbi, sortedOraclesAbi} from '../../core/abi.js';
import {chainNow, type ChainContext} from '../../core/chain.js';
import {Side, type ForesightAgent, type Intent, type MarketView, type Research} from '../../core/types.js';

/**
 * Fiyat Nobetcisi -- the price sentinel.
 *
 * Takes a view on threshold questions about Mento-quoted prices by reading the same
 * SortedOracles median the {@link MentoPriceResolver} will settle against. Because agent
 * and resolver read one source, the agent is never guessing what "the price" means; the
 * only thing it is actually forecasting is drift between now and settlement.
 */
export class PriceSentinel implements ForesightAgent {
  readonly name = 'price-sentinel';
  readonly description =
    'Forecasts Mento oracle price thresholds on Celo by reading SortedOracles directly.';

  agentId?: bigint;

  /** Cached after the first read; the resolver's oracle is immutable. */
  private oraclesAddress?: Address;

  constructor(
    private readonly ctx: ChainContext,
    /** Address of the deployed MentoPriceResolver; markets pointing elsewhere are out of scope. */
    private readonly resolverAddress: Address,
  ) {}

  isInScope(market: MarketView): boolean {
    return market.resolver.toLowerCase() === this.resolverAddress.toLowerCase();
  }

  /**
   * The oracle the resolver will actually settle against.
   *
   * Read from the resolver rather than from this project's address table, because the two
   * can differ and the difference is silent: on Celo Sepolia the resolver points at a
   * maintained stand-in, while the table holds Mento's own (unmaintained) SortedOracles.
   * Reading a different median than the one that will settle the market would break the
   * agent's central claim -- that it forecasts drift, not the meaning of "the price".
   */
  private async oracles(): Promise<Address> {
    if (!this.oraclesAddress) {
      this.oraclesAddress = await this.ctx.publicClient.readContract({
        address: this.resolverAddress,
        abi: mentoPriceResolverAbi,
        functionName: 'sortedOracles',
      });
    }
    return this.oraclesAddress;
  }

  async research(market: MarketView): Promise<Research> {
    const config = decodeConfig(market.resolverConfig);
    const oracles = await this.oracles();

    const [[numerator, denominator], reportedAt, reporters] = await Promise.all([
      this.ctx.publicClient.readContract({
        address: oracles,
        abi: sortedOraclesAbi,
        functionName: 'medianRate',
        args: [config.rateFeedId],
      }),
      this.ctx.publicClient.readContract({
        address: oracles,
        abi: sortedOraclesAbi,
        functionName: 'medianTimestamp',
        args: [config.rateFeedId],
      }),
      this.ctx.publicClient.readContract({
        address: oracles,
        abi: sortedOraclesAbi,
        functionName: 'numRates',
        args: [config.rateFeedId],
      }),
    ]);

    const sources = [
      `celo:${this.ctx.chainId}/sortedOracles:${oracles}/medianRate(${config.rateFeedId})`,
      `median=${numerator}/${denominator} reportedAt=${reportedAt} reporters=${reporters}`,
    ];

    if (reporters === 0n || denominator === 0n) {
      return {
        marketId: market.id,
        probabilityYes: 0.5,
        confidence: 0,
        rationale: 'The rate feed has no usable median right now, so there is nothing to forecast from.',
        sources,
      };
    }

    // Current median in the resolver's own fixed-point scale.
    const medianFixed = (numerator * 10n ** 24n) / denominator;
    const margin = relativeMargin(medianFixed, config.thresholdFixed);
    const clearsNow = config.comparator === Comparator.AtOrAbove
      ? medianFixed >= config.thresholdFixed
      : medianFixed <= config.thresholdFixed;

    // The further the current median sits from the threshold, the less likely drift
    // before settlement flips the answer. Time to settlement cuts the other way.
    const now = await chainNow(this.ctx);
    const hoursToSettlement = Math.max(0, (market.resolvesAt - now) / 3600);
    const confidence = clampUnit(margin / (0.02 + 0.004 * hoursToSettlement));
    const probabilityYes = clearsNow ? 0.5 + confidence / 2 : 0.5 - confidence / 2;

    const staleness = now - Number(reportedAt);
    const stale = staleness > Number(config.maxStaleness);

    return {
      marketId: market.id,
      probabilityYes,
      confidence: stale ? 0 : confidence,
      rationale: stale
        ? `Median is ${staleness}s old, past the market's ${config.maxStaleness}s staleness limit; this market may void.`
        : `Median is ${(margin * 100).toFixed(2)}% ${clearsNow ? 'past' : 'short of'} the threshold with ` +
          `${hoursToSettlement.toFixed(1)}h to settlement.`,
      sources,
    };
  }

  async position(market: MarketView, research: Research): Promise<Intent> {
    if (research.confidence <= 0) {
      return {kind: 'pass', marketId: market.id, reason: research.rationale};
    }

    const side = research.probabilityYes >= 0.5 ? Side.Yes : Side.No;
    // The runner clamps this against the real caps; here we only express appetite.
    const amount = BigInt(Math.round(research.confidence * 1e6));
    return {kind: 'stake', marketId: market.id, side, amount, research};
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
      {name: 'rateFeedId', type: 'address'},
      {name: 'thresholdFixed', type: 'uint256'},
      {name: 'comparator', type: 'uint8'},
      {name: 'maxStaleness', type: 'uint64'},
    ],
  },
] as const;

function decodeConfig(data: `0x${string}`) {
  const [config] = decodeAbiParameters(CONFIG_ABI, data);
  return {
    rateFeedId: config.rateFeedId,
    thresholdFixed: config.thresholdFixed,
    comparator: config.comparator as Comparator,
    maxStaleness: config.maxStaleness,
  };
}

/** |median - threshold| / threshold, as a plain number. */
function relativeMargin(median: bigint, threshold: bigint): number {
  if (threshold === 0n) return 0;
  const diff = median > threshold ? median - threshold : threshold - median;
  return Number((diff * 10_000n) / threshold) / 10_000;
}

function clampUnit(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}
