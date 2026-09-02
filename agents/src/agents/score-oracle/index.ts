import {decodeAbiParameters, type Address, type Hex} from 'viem';

import {Side, type ForesightAgent, type Intent, type MarketView, type Research} from '../../core/types.js';
import {NullScoreFeed, type ScoreFeed} from './feed.js';

/**
 * Skor Kahini -- the score oracle.
 *
 * The only one of the three agents whose data lives off-chain, which makes it the only
 * one whose settlement needs an attestor (see AttestedScoreResolver). The agent's honest
 * position is therefore narrower than the other two: it forecasts fixtures it can read
 * from a public API, cites the URL in every rationale, and passes outright when the feed
 * has nothing.
 *
 * A market's resolverConfig only carries an `eventKey` hash, so the mapping from key to
 * fixture is held here. That mapping is part of the public market description -- an agent
 * that could not tell you which fixture a key refers to has no business staking on it.
 */
export class ScoreOracle implements ForesightAgent {
  readonly name = 'score-oracle';
  readonly description = 'Forecasts public sporting fixtures and cites the source for every call.';

  agentId?: bigint;

  constructor(
    private readonly resolverAddress: Address,
    private readonly feed: ScoreFeed = new NullScoreFeed(),
    /** eventKey (bytes32, lowercase hex) -> the provider's fixture id and what YES means. */
    private readonly eventKeys: ReadonlyMap<string, {fixtureId: string; yesMeans: 'home-win' | 'away-win' | 'draw'}> =
      new Map(),
  ) {}

  isInScope(market: MarketView): boolean {
    if (market.resolver.toLowerCase() !== this.resolverAddress.toLowerCase()) return false;
    const key = this.eventKeyOf(market);
    return key !== null && this.eventKeys.has(key);
  }

  async research(market: MarketView): Promise<Research> {
    const key = this.eventKeyOf(market);
    const mapping = key ? this.eventKeys.get(key) : undefined;

    if (!mapping) {
      return {
        marketId: market.id,
        probabilityYes: 0.5,
        confidence: 0,
        rationale: 'No fixture is mapped to this event key, so there is nothing to read.',
        sources: [],
      };
    }

    const fixture = await this.feed.getFixture(mapping.fixtureId);
    if (!fixture) {
      return {
        marketId: market.id,
        probabilityYes: 0.5,
        confidence: 0,
        rationale: `Feed "${this.feed.providerName}" returned nothing for fixture ${mapping.fixtureId}.`,
        sources: [],
      };
    }

    const sources = [fixture.sourceUrl, `provider=${this.feed.providerName} fixture=${fixture.id}`];

    // A finished fixture is not a forecast, it is a fact. Say so, and stake accordingly.
    if (fixture.status === 'finished' && fixture.homeScore !== undefined && fixture.awayScore !== undefined) {
      const yes = outcomeMatches(mapping.yesMeans, fixture.homeScore, fixture.awayScore);
      return {
        marketId: market.id,
        probabilityYes: yes ? 1 : 0,
        confidence: 1,
        rationale:
          `${fixture.homeTeam} ${fixture.homeScore}-${fixture.awayScore} ${fixture.awayTeam} (final). ` +
          `YES means ${mapping.yesMeans}, so the answer is ${yes ? 'YES' : 'NO'}.`,
        sources,
      };
    }

    return {
      marketId: market.id,
      probabilityYes: 0.5,
      confidence: 0,
      rationale:
        `${fixture.homeTeam} vs ${fixture.awayTeam} is ${fixture.status}; ` +
        'this agent does not model unplayed fixtures, it only reports played ones.',
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

  private eventKeyOf(market: MarketView): string | null {
    try {
      const [config] = decodeAbiParameters([{type: 'tuple', components: [{name: 'eventKey', type: 'bytes32'}]}], market.resolverConfig as Hex);
      return config.eventKey.toLowerCase();
    } catch {
      return null;
    }
  }
}

function outcomeMatches(yesMeans: 'home-win' | 'away-win' | 'draw', home: number, away: number): boolean {
  if (yesMeans === 'home-win') return home > away;
  if (yesMeans === 'away-win') return away > home;
  return home === away;
}
