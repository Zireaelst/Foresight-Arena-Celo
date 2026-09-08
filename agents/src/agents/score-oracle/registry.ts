import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {eventKeyFor, parseCondition, type Condition} from './consensus.js';
import type {FixtureRef} from './providers/types.js';

export interface FixtureEntry {
  ref: FixtureRef;
  condition: Condition;
  question: string;
  /** Derived, never assigned -- see {@link eventKeyFor}. */
  eventKey: `0x${string}`;
}

interface RawFixture {
  league: string;
  kickoffDate: string;
  homeTeam: string;
  awayTeam: string;
  condition: string;
  question: string;
}

/**
 * The fixtures this deployment knows about, loaded from `shared/fixtures.json`.
 *
 * Kept as data outside the code, and shared with the dashboard, so that "which fixture
 * does event key 0xabc… mean?" has exactly one answer that both the agent and anyone
 * reading the repo can check. A market whose key is not in here is out of scope: the
 * agent refuses to stake on a question it cannot describe.
 */
export function loadFixtureRegistry(path?: string): Map<string, FixtureEntry> {
  const file = path ?? defaultPath();
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as {fixtures?: RawFixture[]};
  const entries = new Map<string, FixtureEntry>();

  for (const raw of parsed.fixtures ?? []) {
    const ref: FixtureRef = {
      league: raw.league,
      kickoffDate: raw.kickoffDate,
      homeTeam: raw.homeTeam,
      awayTeam: raw.awayTeam,
    };
    const condition = parseCondition(raw.condition);
    const eventKey = eventKeyFor(ref, condition);
    entries.set(eventKey.toLowerCase(), {ref, condition, question: raw.question, eventKey});
  }
  return entries;
}

function defaultPath(): string {
  // agents/src/agents/score-oracle -> repo root
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', '..', '..', 'shared', 'fixtures.json');
}
