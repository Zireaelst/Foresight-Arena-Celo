import {LEAGUES, fetchJson, sameTeam, type FixtureRef, type Observation, type ScoreProvider} from './types.js';

interface TsdbEvent {
  idEvent?: string;
  strHomeTeam?: string;
  strAwayTeam?: string;
  strTimestamp?: string;
  dateEvent?: string;
  intHomeScore?: string | null;
  intAwayScore?: string | null;
  strStatus?: string | null;
  strPostponed?: string | null;
}

/** Statuses TheSportsDB uses for a match that has actually been played to completion. */
const FINISHED = new Set(['ft', 'aet', 'pen', 'finished', 'match finished', 'fulltime', 'full time']);

/**
 * TheSportsDB, free tier (the public `3` key). No registration, no secret.
 *
 * Chosen as a consensus member precisely because it needs no credential: a source that
 * anyone can query without an account is a source anyone can use to check our work.
 */
export class TheSportsDbProvider implements ScoreProvider {
  readonly name = 'thesportsdb';

  constructor(private readonly apiKey = process.env.THESPORTSDB_KEY?.trim() || '3') {}

  supports(league: string): boolean {
    return Boolean(LEAGUES[league]?.thesportsdb);
  }

  async observe(ref: FixtureRef): Promise<Observation | null> {
    const leagueId = LEAGUES[ref.league]?.thesportsdb;
    if (!leagueId) return null;

    const base = `https://www.thesportsdb.com/api/v1/json/${this.apiKey}`;
    // Day-scoped query first, then the league's recent results. The day endpoint is
    // exact but only covers scheduled days; the past-results endpoint covers matches
    // that moved.
    const candidates = [
      `${base}/eventsday.php?d=${ref.kickoffDate}&l=${leagueId}`,
      `${base}/eventspastleague.php?id=${leagueId}`,
    ];

    for (const url of candidates) {
      const body = (await fetchJson(url)) as {events?: TsdbEvent[] | null} | null;
      const match = (body?.events ?? []).find((e) => this.matches(e, ref));
      if (match) return this.toObservation(match, ref);
    }
    return null;
  }

  private matches(event: TsdbEvent, ref: FixtureRef): boolean {
    const day = (event.strTimestamp ?? event.dateEvent ?? '').slice(0, 10);
    if (day !== ref.kickoffDate) return false;
    return (
      sameTeam(event.strHomeTeam ?? '', ref.homeTeam) && sameTeam(event.strAwayTeam ?? '', ref.awayTeam)
    );
  }

  private toObservation(event: TsdbEvent, ref: FixtureRef): Observation {
    const status = (event.strStatus ?? '').trim().toLowerCase();
    const home = Number(event.intHomeScore);
    const away = Number(event.intAwayScore);
    const postponed = (event.strPostponed ?? 'no').toLowerCase() === 'yes';

    // Scores present but no status is common on this provider once a match is in the
    // past-results feed; treat a complete scoreline on a past date as finished.
    const hasScores = Number.isFinite(home) && Number.isFinite(away)
      && event.intHomeScore !== null && event.intHomeScore !== ''
      && event.intAwayScore !== null && event.intAwayScore !== '';
    const finished = !postponed && hasScores && (FINISHED.has(status) || status === '' || status === 'match finished');

    return {
      provider: this.name,
      finished,
      homeScore: finished ? home : 0,
      awayScore: finished ? away : 0,
      sourceUrl: event.idEvent
        ? `https://www.thesportsdb.com/event/${event.idEvent}`
        : `https://www.thesportsdb.com/season/${LEAGUES[ref.league]?.thesportsdb}`,
    };
  }
}
