import {keccak256, toHex} from 'viem';

import {Outcome} from '../../core/types.js';
import {EspnProvider} from './providers/espn.js';
import {FootballDataProvider} from './providers/footballData.js';
import {TheSportsDbProvider} from './providers/thesportsdb.js';
import {LEAGUES, normalizeTeam, type FixtureRef, type Observation, type ScoreProvider} from './providers/types.js';

export type {FixtureRef, Observation} from './providers/types.js';
export {LEAGUES} from './providers/types.js';

/**
 * The YES condition of a market, as a closed set rather than free text.
 *
 * v1 accepts only objective questions, and "objective" has to mean something a program
 * can evaluate. A condition here is a total function from a final scoreline to YES/NO,
 * so once the scoreline is agreed there is nothing left to interpret.
 */
export type Condition =
  | {kind: 'home_win'}
  | {kind: 'away_win'}
  | {kind: 'draw'}
  | {kind: 'total_goals_at_least'; goals: number};

export function conditionToString(c: Condition): string {
  return c.kind === 'total_goals_at_least' ? `total_goals_at_least:${c.goals}` : c.kind;
}

export function parseCondition(text: string): Condition {
  const [kind, arg] = text.split(':');
  switch (kind) {
    case 'home_win':
    case 'away_win':
    case 'draw':
      return {kind};
    case 'total_goals_at_least': {
      const goals = Number(arg);
      if (!Number.isInteger(goals) || goals < 0) throw new Error(`Bad goal count in condition "${text}"`);
      return {kind: 'total_goals_at_least', goals};
    }
    default:
      throw new Error(`Unknown condition "${text}"`);
  }
}

export function evaluate(condition: Condition, homeScore: number, awayScore: number): Outcome {
  switch (condition.kind) {
    case 'home_win':
      return homeScore > awayScore ? Outcome.Yes : Outcome.No;
    case 'away_win':
      return awayScore > homeScore ? Outcome.Yes : Outcome.No;
    case 'draw':
      return homeScore === awayScore ? Outcome.Yes : Outcome.No;
    case 'total_goals_at_least':
      return homeScore + awayScore >= condition.goals ? Outcome.Yes : Outcome.No;
  }
}

/**
 * The canonical string identifying "this event, this question".
 *
 * Written down rather than left implicit because it is the thing anyone auditing a
 * market has to be able to reproduce: normalized team names mean two people who spell
 * "Man Utd" differently still derive the same key.
 */
export function canonicalFixtureString(ref: FixtureRef, condition: Condition): string {
  return [
    'foresight-arena/fixture/1',
    ref.league,
    ref.kickoffDate,
    normalizeTeam(ref.homeTeam),
    normalizeTeam(ref.awayTeam),
    conditionToString(condition),
  ].join('|');
}

/** The `eventKey` an {@link AttestedScoreResolver} market is keyed by. */
export function eventKeyFor(ref: FixtureRef, condition: Condition): `0x${string}` {
  return keccak256(toHex(canonicalFixtureString(ref, condition)));
}

export interface ConsensusDecided {
  status: 'decided';
  homeScore: number;
  awayScore: number;
  outcome: Outcome;
  /** Providers that reported this exact scoreline. */
  agreeing: Observation[];
  /** Providers that answered but reported something else. Empty in the happy path. */
  dissenting: Observation[];
  /** Hash of {@link payload}; this is what goes on chain. */
  payloadHash: `0x${string}`;
  /** Canonical JSON of every observation, so the hash is reproducible from the sources. */
  payload: string;
  /** Every source URL a human can open, joined for the on-chain `sourceURI` field. */
  sourceURI: string;
}

export interface ConsensusUndecided {
  status: 'undecided';
  reason: string;
  observations: Observation[];
}

export type ConsensusResult = ConsensusDecided | ConsensusUndecided;

export interface ScoreConsensusOptions {
  providers?: ScoreProvider[];
  /** How many independent providers must report the same final scoreline. */
  quorum?: number;
}

/**
 * Resolves a fixture by agreement between independent free score APIs.
 *
 * This is the answer to the one genuine trust weakness in the design (docs/DECISIONS.md
 * D-05): sports results have no on-chain source, so *something* off chain has to be
 * believed. Believing one API means believing whoever operates it. Requiring several
 * unaffiliated APIs to report the same scoreline does not remove trust, but it changes
 * what has to go wrong: a single operator's mistake or edit now produces a refusal to
 * settle rather than a wrong settlement.
 *
 * The rules are deliberately conservative:
 *  - Only *finished* matches count. A provider that says "in progress" is not a vote.
 *  - Agreement must be on the exact scoreline, not merely on who won.
 *  - Short of quorum, or with any dissent, the feed returns `undecided`. The market then
 *    waits, and if the data never firms up the escape hatch is `voidMarket` -- a refund.
 *    Refusing to answer is always available; answering wrongly is not recoverable.
 */
export class ScoreConsensus {
  private readonly providers: ScoreProvider[];
  readonly quorum: number;

  constructor(options: ScoreConsensusOptions = {}) {
    this.providers = options.providers ?? [
      new TheSportsDbProvider(),
      new EspnProvider(),
      new FootballDataProvider(),
    ];
    this.quorum = options.quorum ?? Number(process.env.SCORE_FEED_QUORUM ?? 2);
  }

  /** Providers that cover this competition at all. */
  panelFor(league: string): ScoreProvider[] {
    return this.providers.filter((p) => p.supports(league));
  }

  async resolve(ref: FixtureRef, condition: Condition): Promise<ConsensusResult> {
    if (!LEAGUES[ref.league]) {
      return {status: 'undecided', reason: `Unknown competition "${ref.league}"`, observations: []};
    }

    const panel = this.panelFor(ref.league);
    if (panel.length < this.quorum) {
      return {
        status: 'undecided',
        reason: `Only ${panel.length} provider(s) cover ${ref.league}; quorum is ${this.quorum}`,
        observations: [],
      };
    }

    const settled = await Promise.all(panel.map((p) => p.observe(ref).catch(() => null)));
    const observations = settled.filter((o): o is Observation => o !== null);
    const finished = observations.filter((o) => o.finished);

    if (finished.length < this.quorum) {
      return {
        status: 'undecided',
        reason: `${finished.length} of ${panel.length} provider(s) report the match finished; quorum is ${this.quorum}`,
        observations,
      };
    }

    // Group by exact scoreline and take the largest bloc.
    const blocs = new Map<string, Observation[]>();
    for (const o of finished) {
      const key = `${o.homeScore}-${o.awayScore}`;
      blocs.set(key, [...(blocs.get(key) ?? []), o]);
    }
    const [best, ...rest] = [...blocs.values()].sort((a, b) => b.length - a.length);

    if (!best || best.length < this.quorum) {
      return {
        status: 'undecided',
        reason: `Providers disagree on the scoreline: ${[...blocs.keys()].join(' vs ')}`,
        observations: finished,
      };
    }

    const dissenting = rest.flat();
    if (dissenting.length > 0) {
      // A quorum exists but somebody reports something else. Do not out-vote a
      // disagreement about a matter of fact -- one of the sources is wrong and we cannot
      // tell which, so this market waits or voids.
      return {
        status: 'undecided',
        reason: `Quorum reached at ${best[0]!.homeScore}-${best[0]!.awayScore} but ${dissenting
          .map((d) => `${d.provider} says ${d.homeScore}-${d.awayScore}`)
          .join('; ')}`,
        observations: finished,
      };
    }

    const {homeScore, awayScore} = best[0]!;
    const payload = JSON.stringify({
      schema: 'foresight-arena/score-consensus/1',
      fixture: canonicalFixtureString(ref, condition),
      homeScore,
      awayScore,
      quorum: this.quorum,
      observations: best
        .map((o) => ({provider: o.provider, homeScore: o.homeScore, awayScore: o.awayScore, sourceUrl: o.sourceUrl}))
        .sort((a, b) => a.provider.localeCompare(b.provider)),
    });

    return {
      status: 'decided',
      homeScore,
      awayScore,
      outcome: evaluate(condition, homeScore, awayScore),
      agreeing: best,
      dissenting: [],
      payloadHash: keccak256(toHex(payload)),
      payload,
      sourceURI: best.map((o) => o.sourceUrl).join(' '),
    };
  }
}
