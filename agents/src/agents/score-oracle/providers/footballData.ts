import {LEAGUES, fetchJson, sameTeam, type FixtureRef, type Observation, type ScoreProvider} from './types.js';

interface FdMatch {
  id?: number;
  utcDate?: string;
  status?: string;
  homeTeam?: {name?: string; shortName?: string};
  awayTeam?: {name?: string; shortName?: string};
  score?: {fullTime?: {home?: number | null; away?: number | null}};
}

/**
 * football-data.org. The one optional member of the panel: its free tier needs a token.
 *
 * The consensus feed runs without it -- {@link ScoreConsensus} simply counts one fewer
 * vote -- so the project has no credential on its critical path. Setting
 * `FOOTBALL_DATA_TOKEN` adds a third independent opinion to soccer markets.
 */
export class FootballDataProvider implements ScoreProvider {
  readonly name = 'football-data';

  constructor(private readonly token = process.env.FOOTBALL_DATA_TOKEN?.trim() ?? '') {}

  get available(): boolean {
    return this.token.length > 0;
  }

  supports(league: string): boolean {
    return this.available && Boolean(LEAGUES[league]?.footballData);
  }

  async observe(ref: FixtureRef): Promise<Observation | null> {
    const code = LEAGUES[ref.league]?.footballData;
    if (!code || !this.available) return null;

    const body = (await fetchJson(
      `https://api.football-data.org/v4/competitions/${code}/matches?dateFrom=${ref.kickoffDate}&dateTo=${ref.kickoffDate}`,
      {headers: {'X-Auth-Token': this.token}},
    )) as {matches?: FdMatch[]} | null;

    for (const match of body?.matches ?? []) {
      const homeName = match.homeTeam?.name ?? match.homeTeam?.shortName ?? '';
      const awayName = match.awayTeam?.name ?? match.awayTeam?.shortName ?? '';
      if (!sameTeam(homeName, ref.homeTeam) || !sameTeam(awayName, ref.awayTeam)) continue;

      const finished = match.status === 'FINISHED';
      const full = match.score?.fullTime;
      return {
        provider: this.name,
        finished: finished && typeof full?.home === 'number' && typeof full?.away === 'number',
        homeScore: finished ? (full?.home ?? 0) : 0,
        awayScore: finished ? (full?.away ?? 0) : 0,
        sourceUrl: `https://www.football-data.org/match/${match.id ?? ''}`,
      };
    }
    return null;
  }
}
