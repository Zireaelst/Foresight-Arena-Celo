import assert from 'node:assert/strict';
import {test} from 'node:test';

import {Outcome} from '../../core/types.js';
import {
  ScoreConsensus,
  canonicalFixtureString,
  eventKeyFor,
  evaluate,
  parseCondition,
  type Condition,
} from './consensus.js';
import {normalizeTeam, sameTeam, type FixtureRef, type Observation, type ScoreProvider} from './providers/types.js';

const REF: FixtureRef = {league: 'eng.1', kickoffDate: '2026-09-06', homeTeam: 'Arsenal', awayTeam: 'Chelsea'};
const HOME_WIN: Condition = {kind: 'home_win'};

/** A provider that reports exactly what the test tells it to, without network access. */
function stub(name: string, observation: Observation | null): ScoreProvider {
  return {
    name,
    supports: () => true,
    observe: async () => observation,
  };
}

function seen(provider: string, homeScore: number, awayScore: number, finished = true): Observation {
  return {provider, finished, homeScore, awayScore, sourceUrl: `https://example.test/${provider}`};
}

// -- condition evaluation ------------------------------------------------

test('conditions evaluate a scoreline without ambiguity', () => {
  assert.equal(evaluate({kind: 'home_win'}, 2, 1), Outcome.Yes);
  assert.equal(evaluate({kind: 'home_win'}, 1, 1), Outcome.No, 'a draw is not a home win');
  assert.equal(evaluate({kind: 'away_win'}, 1, 2), Outcome.Yes);
  assert.equal(evaluate({kind: 'draw'}, 1, 1), Outcome.Yes);
  assert.equal(evaluate({kind: 'total_goals_at_least', goals: 3}, 2, 1), Outcome.Yes, 'boundary is inclusive');
  assert.equal(evaluate({kind: 'total_goals_at_least', goals: 4}, 2, 1), Outcome.No);
});

test('unknown or malformed conditions are rejected rather than guessed', () => {
  assert.throws(() => parseCondition('whoever_i_like'));
  assert.throws(() => parseCondition('total_goals_at_least:many'));
  assert.throws(() => parseCondition('total_goals_at_least:-1'));
  assert.deepEqual(parseCondition('total_goals_at_least:3'), {kind: 'total_goals_at_least', goals: 3});
});

// -- event keys ----------------------------------------------------------

test('the event key is reproducible from the fixture, not assigned', () => {
  const a = eventKeyFor(REF, HOME_WIN);
  const b = eventKeyFor({...REF, homeTeam: 'ARSENAL FC'}, HOME_WIN);
  assert.equal(a, b, 'team-name spelling must not change the key');

  const different = eventKeyFor(REF, {kind: 'draw'});
  assert.notEqual(a, different, 'a different question is a different key');
  assert.match(canonicalFixtureString(REF, HOME_WIN), /^foresight-arena\/fixture\/1\|eng\.1\|2026-09-06\|/);
});

// -- team-name normalisation --------------------------------------------

test('team names normalise across providers without collapsing distinct clubs', () => {
  assert.ok(sameTeam('Man Utd', 'Manchester United'));
  assert.ok(sameTeam('Beşiktaş', 'Besiktas'), 'diacritics must not split a club');
  assert.ok(sameTeam('Wolverhampton', 'Wolverhampton Wanderers'));
  assert.ok(!sameTeam('Manchester United', 'Manchester City'), 'two real clubs must stay distinct');
  assert.ok(!sameTeam('Arsenal', 'Aston Villa'));
  assert.ok(sameTeam('FC Bayern München', 'Bayern Munich'));
  assert.ok(sameTeam('Atlético Madrid', 'Atletico de Madrid'));
  assert.ok(sameTeam('Inter', 'Internazionale'));

  // A leading designator must be dropped only as a whole token. The regression this
  // guards: a bare-prefix rule strips the "as" out of "Arsenal" and yields "enal".
  assert.equal(normalizeTeam('Arsenal'), 'arsenal');
  assert.equal(normalizeTeam('Aston Villa'), 'astonvilla');
  assert.equal(normalizeTeam('AS Roma'), 'roma');
  assert.equal(normalizeTeam('AC Milan'), 'milan');
  assert.ok(!sameTeam('AS Roma', 'Arsenal'));
});

// -- consensus rules -----------------------------------------------------

test('a quorum of agreeing providers settles the market', async () => {
  const consensus = new ScoreConsensus({
    quorum: 2,
    providers: [stub('a', seen('a', 2, 1)), stub('b', seen('b', 2, 1))],
  });
  const result = await consensus.resolve(REF, HOME_WIN);

  assert.equal(result.status, 'decided');
  if (result.status !== 'decided') return;
  assert.equal(result.outcome, Outcome.Yes);
  assert.equal(result.agreeing.length, 2);
  assert.match(result.payloadHash, /^0x[0-9a-f]{64}$/);
  assert.ok(result.sourceURI.includes('example.test/a'));
});

test('one source short of quorum is not enough', async () => {
  const consensus = new ScoreConsensus({
    quorum: 2,
    providers: [stub('a', seen('a', 2, 1)), stub('b', null)],
  });
  const result = await consensus.resolve(REF, HOME_WIN);
  assert.equal(result.status, 'undecided');
});

test('an unfinished match is not a vote', async () => {
  const consensus = new ScoreConsensus({
    quorum: 2,
    providers: [stub('a', seen('a', 2, 1)), stub('b', seen('b', 0, 0, false))],
  });
  const result = await consensus.resolve(REF, HOME_WIN);
  assert.equal(result.status, 'undecided');
});

/**
 * The rule that matters most: a quorum plus a dissenter must NOT settle. Out-voting a
 * disagreement about a matter of fact would mean settling while knowing one source says
 * otherwise -- and unlike refusing, that is not recoverable.
 */
test('a dissenting source blocks settlement even when a quorum agrees', async () => {
  const consensus = new ScoreConsensus({
    quorum: 2,
    providers: [stub('a', seen('a', 2, 1)), stub('b', seen('b', 2, 1)), stub('c', seen('c', 3, 1))],
  });
  const result = await consensus.resolve(REF, HOME_WIN);

  assert.equal(result.status, 'undecided');
  if (result.status !== 'undecided') return;
  assert.match(result.reason, /c says 3-1/);
});

test('providers that disagree entirely settle nothing', async () => {
  const consensus = new ScoreConsensus({
    quorum: 2,
    providers: [stub('a', seen('a', 2, 1)), stub('b', seen('b', 1, 2))],
  });
  assert.equal((await consensus.resolve(REF, HOME_WIN)).status, 'undecided');
});

test('a provider that throws is survivable, not fatal', async () => {
  const exploding: ScoreProvider = {
    name: 'broken',
    supports: () => true,
    observe: async () => {
      throw new Error('network on fire');
    },
  };
  const consensus = new ScoreConsensus({
    quorum: 2,
    providers: [stub('a', seen('a', 2, 1)), stub('b', seen('b', 2, 1)), exploding],
  });
  const result = await consensus.resolve(REF, HOME_WIN);
  assert.equal(result.status, 'decided');
});

test('an unknown competition is refused', async () => {
  const consensus = new ScoreConsensus({quorum: 2, providers: [stub('a', seen('a', 1, 0))]});
  const result = await consensus.resolve({...REF, league: 'not.a.league'}, HOME_WIN);
  assert.equal(result.status, 'undecided');
});

test('the payload hash covers the scoreline, so it changes when the reading does', async () => {
  const one = await new ScoreConsensus({
    quorum: 2,
    providers: [stub('a', seen('a', 2, 1)), stub('b', seen('b', 2, 1))],
  }).resolve(REF, HOME_WIN);
  const two = await new ScoreConsensus({
    quorum: 2,
    providers: [stub('a', seen('a', 3, 1)), stub('b', seen('b', 3, 1))],
  }).resolve(REF, HOME_WIN);

  assert.equal(one.status, 'decided');
  assert.equal(two.status, 'decided');
  if (one.status !== 'decided' || two.status !== 'decided') return;
  assert.notEqual(one.payloadHash, two.payloadHash);
});
