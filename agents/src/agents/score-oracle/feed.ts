/**
 * D-07 is closed: the sports data source is a *panel* of independent free APIs rather
 * than a single provider.
 *
 * The reasoning is in docs/DECISIONS.md. In short: picking one API would have made its
 * operator the silent authority behind every sports market, which is exactly the trusted
 * third party the rest of the project works to avoid. Requiring several unaffiliated
 * sources to report the same final scoreline turns a single operator's error from a
 * wrong settlement into a refusal to settle -- and refusing is always safe here, because
 * an unsettled market can be voided and refunded.
 *
 * The implementation lives in {@link ./consensus.ts}; this module re-exports the pieces
 * the rest of the codebase uses.
 */
export {
  ScoreConsensus,
  canonicalFixtureString,
  conditionToString,
  eventKeyFor,
  evaluate,
  parseCondition,
  type Condition,
  type ConsensusDecided,
  type ConsensusResult,
  type ConsensusUndecided,
  type FixtureRef,
  type Observation,
} from './consensus.js';

export {LEAGUES, normalizeTeam, sameTeam, type ScoreProvider} from './providers/types.js';
export {TheSportsDbProvider} from './providers/thesportsdb.js';
export {EspnProvider} from './providers/espn.js';
export {FootballDataProvider} from './providers/footballData.js';
export {loadFixtureRegistry, type FixtureEntry} from './registry.js';
