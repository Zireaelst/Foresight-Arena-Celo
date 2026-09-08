import {decodeAbiParameters, type Address, type Hex} from 'viem';

import {Outcome, Side, type ForesightAgent, type Intent, type MarketView, type Research} from '../../core/types.js';
import {ScoreConsensus, type Condition, type ConsensusResult} from './consensus.js';
import type {FixtureRef} from './providers/types.js';

/**
 * Where the agent gets a scoreline from.
 *
 * Two implementations satisfy it: {@link ScoreConsensus}, which queries the public APIs
 * directly, and {@link PurchasedScoreFeed}, which buys the same report over x402. The
 * agent is written against the interface so that paying for data is a deployment choice
 * rather than a different agent.
 */
export interface ScoreSource {
  readonly quorum: number;
  panelFor(league: string): {name: string}[] | string[];
  resolve(ref: FixtureRef, condition: Condition): Promise<ConsensusResult>;
}
import {loadFixtureRegistry, type FixtureEntry} from './registry.js';

/**
 * Skor Kahini -- the score oracle.
 *
 * The only one of the three agents whose data lives off-chain, which makes it the only
 * one whose settlement needs an attestor (see AttestedScoreResolver). Its honest position
 * is therefore narrower than the other two: it reports fixtures that a panel of
 * independent public APIs agree on, cites every one of their URLs, and passes outright
 * when they do not agree.
 *
 * It does not model unplayed fixtures. Forecasting a football match from no information
 * would be guessing dressed up as research, and every rationale this project emits is
 * supposed to be something a reader can re-check.
 */
export class ScoreOracle implements ForesightAgent {
  readonly name = 'score-oracle';
  readonly description =
    'Reports public sporting fixtures that independent score APIs agree on, and cites all of them.';

  agentId?: bigint;

  private readonly registry: ReadonlyMap<string, FixtureEntry>;

  constructor(
    private readonly resolverAddress: Address,
    private readonly consensus: ScoreSource = new ScoreConsensus(),
    registry?: ReadonlyMap<string, FixtureEntry>,
  ) {
    this.registry = registry ?? loadFixtureRegistry();
  }

  isInScope(market: MarketView): boolean {
    if (market.resolver.toLowerCase() !== this.resolverAddress.toLowerCase()) return false;
    const key = this.eventKeyOf(market);
    return key !== null && this.registry.has(key);
  }

  async research(market: MarketView): Promise<Research> {
    const key = this.eventKeyOf(market);
    const entry = key ? this.registry.get(key) : undefined;

    if (!entry) {
      return {
        marketId: market.id,
        probabilityYes: 0.5,
        confidence: 0,
        rationale:
          'This market\'s event key is not in the published fixture registry, so the agent cannot say ' +
          'which fixture it refers to. Staking on a question it cannot describe would be indefensible.',
        sources: [],
      };
    }

    const {ref, condition} = entry;
    const panel = this.consensus.panelFor(ref.league).map((p) => (typeof p === 'string' ? p : p.name));
    const result = await this.consensus.resolve(ref, condition);

    if (result.status === 'undecided') {
      return {
        marketId: market.id,
        probabilityYes: 0.5,
        confidence: 0,
        rationale: `No consensus on ${ref.homeTeam} vs ${ref.awayTeam} (${ref.kickoffDate}): ${result.reason}`,
        sources: [
          `panel=${panel.join(',')} quorum=${this.consensus.quorum}`,
          ...result.observations.map((o) => o.sourceUrl),
        ],
      };
    }

    // A finished, agreed fixture is not a forecast -- it is a fact that the market has
    // not yet settled against. Full confidence is honest here, and only here.
    const yes = result.outcome === Outcome.Yes;
    return {
      marketId: market.id,
      probabilityYes: yes ? 1 : 0,
      confidence: 1,
      rationale:
        `${ref.homeTeam} ${result.homeScore}-${result.awayScore} ${ref.awayTeam} (final), agreed by ` +
        `${result.agreeing.map((o) => o.provider).join(' and ')}. YES means ${entry.condition.kind}, ` +
        `so the answer is ${yes ? 'YES' : 'NO'}.`,
      sources: [
        `panel=${panel.join(',')} quorum=${this.consensus.quorum}`,
        `payloadHash=${result.payloadHash}`,
        ...result.agreeing.map((o) => o.sourceUrl),
      ],
    };
  }

  async position(market: MarketView, research: Research): Promise<Intent> {
    if (research.confidence <= 0) {
      return {kind: 'pass', marketId: market.id, reason: research.rationale};
    }
    const side = research.probabilityYes >= 0.5 ? Side.Yes : Side.No;
    return {kind: 'stake', marketId: market.id, side, amount: BigInt(Math.round(research.confidence * 1e6)), research};
  }

  private eventKeyOf(market: MarketView): string | null {
    try {
      const [config] = decodeAbiParameters(
        [{type: 'tuple', components: [{name: 'eventKey', type: 'bytes32'}]}],
        market.resolverConfig as Hex,
      );
      return config.eventKey.toLowerCase();
    } catch {
      return null;
    }
  }
}
