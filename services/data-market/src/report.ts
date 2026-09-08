import {
  ScoreConsensus,
  canonicalFixtureString,
  eventKeyFor,
  parseCondition,
  type FixtureRef,
} from '../../../agents/src/agents/score-oracle/consensus.js';
import {Outcome} from '../../../agents/src/core/types.js';

const consensus = new ScoreConsensus();

/**
 * The product.
 *
 * Deliberately includes everything a buyer would need to reach the same conclusion
 * without us: each source's own reading and URL, the canonical fixture string, and the
 * derived event key. Selling a bare verdict would be selling trust; selling the working
 * out means the buyer can verify what they bought.
 */
export async function buildReport(ref: FixtureRef, conditionText: string) {
  const condition = parseCondition(conditionText);
  const result = await consensus.resolve(ref, condition);
  const eventKey = eventKeyFor(ref, condition);
  const base = {
    schema: 'foresight-arena/score-report/1',
    fixture: canonicalFixtureString(ref, condition),
    eventKey,
    panel: consensus.panelFor(ref.league).map((provider) => provider.name),
    quorum: consensus.quorum,
    producedAt: new Date().toISOString(),
  };

  if (result.status === 'undecided') {
    return {
      ...base,
      status: 'undecided' as const,
      reason: result.reason,
      observations: result.observations,
    };
  }

  return {
    ...base,
    status: 'decided' as const,
    homeScore: result.homeScore,
    awayScore: result.awayScore,
    outcome: Outcome[result.outcome],
    payloadHash: result.payloadHash,
    payload: result.payload,
    sources: result.agreeing.map((o) => ({provider: o.provider, url: o.sourceUrl})),
  };
}
