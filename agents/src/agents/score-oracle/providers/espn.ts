import {LEAGUES, fetchJson, sameTeam, type FixtureRef, type Observation, type ScoreProvider} from './types.js';

interface EspnCompetitor {
  homeAway?: string;
  score?: string;
  team?: {displayName?: string; shortDisplayName?: string; name?: string};
}
interface EspnEvent {
  id?: string;
  date?: string;
  links?: {href?: string}[];
  competitions?: {competitors?: EspnCompetitor[]}[];
  status?: {type?: {completed?: boolean; name?: string}};
}

/**
 * ESPN's public site API. Undocumented but stable, keyless, and backed by an editorial
 * operation independent of the other providers -- which is the property consensus needs.
 */
export class EspnProvider implements ScoreProvider {
  readonly name = 'espn';

  supports(league: string): boolean {
    return Boolean(LEAGUES[league]?.espn);
  }

  async observe(ref: FixtureRef): Promise<Observation | null> {
    const path = LEAGUES[ref.league]?.espn;
    if (!path) return null;

    const dates = ref.kickoffDate.replace(/-/g, '');
    const body = (await fetchJson(
      `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${dates}`,
    )) as {events?: EspnEvent[]} | null;

    for (const event of body?.events ?? []) {
      const competitors = event.competitions?.[0]?.competitors ?? [];
      const home = competitors.find((c) => c.homeAway === 'home');
      const away = competitors.find((c) => c.homeAway === 'away');
      if (!home || !away) continue;

      const homeName = home.team?.displayName ?? home.team?.name ?? '';
      const awayName = away.team?.displayName ?? away.team?.name ?? '';
      if (!sameTeam(homeName, ref.homeTeam) || !sameTeam(awayName, ref.awayTeam)) continue;

      const finished = event.status?.type?.completed === true;
      return {
        provider: this.name,
        finished,
        homeScore: finished ? Number(home.score ?? 0) : 0,
        awayScore: finished ? Number(away.score ?? 0) : 0,
        sourceUrl:
          event.links?.[0]?.href ??
          `https://www.espn.com/${path.split('/')[0]}/match/_/gameId/${event.id ?? ''}`,
      };
    }
    return null;
  }
}
