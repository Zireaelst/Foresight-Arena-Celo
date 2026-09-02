/**
 * The sports data source is still an open decision (see docs/DECISIONS.md, D-06), so the
 * agent talks to this interface rather than to a provider. Swapping in the chosen API
 * means writing one adapter and changing one line in the CLI wiring.
 */
export interface Fixture {
  /** Provider's own id for the fixture. */
  id: string;
  homeTeam: string;
  awayTeam: string;
  /** Unix seconds. */
  kickoffAt: number;
  status: 'scheduled' | 'live' | 'finished' | 'unknown';
  homeScore?: number;
  awayScore?: number;
  /** URL a human can open to check the same fact. */
  sourceUrl: string;
}

export interface ScoreFeed {
  readonly providerName: string;
  getFixture(fixtureId: string): Promise<Fixture | null>;
}

/**
 * Stand-in feed used until D-06 is decided. It answers "I do not know" for everything,
 * which makes the agent pass on every market rather than invent a scoreline -- the
 * correct behaviour for a forecaster with no data.
 */
export class NullScoreFeed implements ScoreFeed {
  readonly providerName = 'null-feed (no provider selected yet -- see docs/DECISIONS.md D-06)';

  async getFixture(): Promise<Fixture | null> {
    return null;
  }
}
