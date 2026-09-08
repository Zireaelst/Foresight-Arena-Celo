/**
 * A sporting event, addressed in a way that does not belong to any one provider.
 *
 * Every free scores API has its own opaque fixture id, so an id from one of them is
 * useless to the others -- and picking one provider's id as the canonical one would
 * quietly make that provider authoritative. Instead a fixture is addressed by facts that
 * are true independently of who is reporting them: the competition, the kickoff date in
 * UTC, and the two teams. Each provider is responsible for finding that match in its own
 * catalogue.
 */
export interface FixtureRef {
  /** Competition key from {@link LEAGUES}, e.g. `eng.1`. */
  league: string;
  /** Kickoff date in UTC, `YYYY-MM-DD`. Deliberately a date, not an instant: providers
   *  disagree by minutes on kickoff time but never on the day. */
  kickoffDate: string;
  homeTeam: string;
  awayTeam: string;
}

/** One provider's reading of a fixture. Never a verdict -- just what it says it saw. */
export interface Observation {
  provider: string;
  /** False when the match has not finished; scores are then meaningless and ignored. */
  finished: boolean;
  homeScore: number;
  awayScore: number;
  /** A page a human can open to check this same reading. */
  sourceUrl: string;
}

export interface ScoreProvider {
  readonly name: string;
  /** Whether this provider covers the competition at all. */
  supports(league: string): boolean;
  /** Returns null when the provider has no record of the fixture (as opposed to a
   *  record saying "not finished yet", which is an Observation with finished=false). */
  observe(ref: FixtureRef): Promise<Observation | null>;
}

/**
 * Competition keys, with each provider's own identifier alongside.
 *
 * Kept in one table on purpose: adding a competition should be a data change that is
 * obviously consistent across providers, not three edits in three files that can drift.
 */
export const LEAGUES: Record<string, {label: string; thesportsdb?: string; espn?: string; footballData?: string}> = {
  'eng.1': {label: 'English Premier League', thesportsdb: '4328', espn: 'soccer/eng.1', footballData: 'PL'},
  'esp.1': {label: 'Spanish La Liga', thesportsdb: '4335', espn: 'soccer/esp.1', footballData: 'PD'},
  'ita.1': {label: 'Italian Serie A', thesportsdb: '4332', espn: 'soccer/ita.1', footballData: 'SA'},
  'ger.1': {label: 'German Bundesliga', thesportsdb: '4331', espn: 'soccer/ger.1', footballData: 'BL1'},
  'fra.1': {label: 'French Ligue 1', thesportsdb: '4334', espn: 'soccer/fra.1', footballData: 'FL1'},
  'tur.1': {label: 'Turkish Super Lig', thesportsdb: '4339', espn: 'soccer/tur.1'},
  'uefa.champions': {label: 'UEFA Champions League', thesportsdb: '4480', espn: 'soccer/uefa.champions', footballData: 'CL'},
  'nba': {label: 'NBA', thesportsdb: '4387', espn: 'basketball/nba'},
};

/**
 * Reduces a team name to something comparable across providers.
 *
 * The same club is "Man United", "Manchester United" and "Manchester Utd" depending on
 * who is asked, so matching raw strings would make providers disagree about which
 * fixture they are even looking at -- the one failure mode that would silently break
 * consensus rather than loudly refuse it.
 */
export function normalizeTeam(name: string): string {
  const tokens = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // drop diacritics: Beşiktaş -> Besiktas
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  // Designators are dropped only when they stand as their own token. Stripping them as
  // bare prefixes instead would maul ordinary names -- "Arsenal" begins with "as", and a
  // prefix rule turns it into "enal".
  const kept = tokens.filter((token) => !DESIGNATORS.has(token));
  // If a name is nothing but designators, keep it as it was rather than return "".
  const joined = (kept.length > 0 ? kept : tokens).join('');

  return ALIASES[joined] ?? joined;
}

/** Club-type words and connectives that only some providers include. */
const DESIGNATORS = new Set([
  'fc', 'afc', 'cf', 'sc', 'ac', 'as', 'ss', 'ssc', 'rc', 'sv', 'vfl', 'vfb', 'tsg', 'fk',
  'sk', 'ad', 'cd', 'ca', 'club', 'calcio', 'de', 'the',
]);

/**
 * Names that normalisation alone cannot reconcile, keyed by their POST-normalisation
 * form. Getting that wrong is silent: a key written in pre-normalisation shape (say
 * "fcbayernmunchen") is simply never consulted.
 */
const ALIASES: Record<string, string> = {
  manutd: 'manchesterunited',
  manunited: 'manchesterunited',
  manchesterutd: 'manchesterunited',
  mancity: 'manchestercity',
  spurs: 'tottenhamhotspur',
  tottenham: 'tottenhamhotspur',
  wolves: 'wolverhamptonwanderers',
  wolverhampton: 'wolverhamptonwanderers',
  brighton: 'brightonhovealbion',
  newcastle: 'newcastleunited',
  nottmforest: 'nottinghamforest',
  forest: 'nottinghamforest',
  westham: 'westhamunited',
  leeds: 'leedsunited',
  atleticomadrid: 'atleticodemadrid',
  intermilan: 'internazionale',
  inter: 'internazionale',
  bayern: 'bayernmunich',
  bayernmunchen: 'bayernmunich',
  psg: 'parissaintgermain',
  parissg: 'parissaintgermain',
};

/** True when two names denote the same club as far as we can tell. */
export function sameTeam(a: string, b: string): boolean {
  const na = normalizeTeam(a);
  const nb = normalizeTeam(b);
  if (na === nb) return true;
  // One provider's short name is often a prefix of another's full name
  // ("Wolverhampton" vs "Wolverhamptonwanderers"). Require a substantial overlap so
  // this cannot collapse two genuinely different clubs.
  const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na];
  return shorter.length >= 6 && longer.startsWith(shorter);
}

/** Fetch with a timeout, so one slow provider cannot stall consensus. */
export async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 12_000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {...init, signal: controller.signal});
    if (!response.ok) return null;
    return await response.json();
  } catch {
    // A provider being down is normal and must not be fatal: consensus is designed to
    // survive losing one. The caller sees `null` and counts one fewer vote.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
