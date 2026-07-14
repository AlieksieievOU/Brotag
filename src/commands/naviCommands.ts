const BO3_API_URL = "https://api.bo3.gg/api/v1";
const NAVI_TEAM_ID = 787;
const MAX_MATCHES = 5;

export type Fetcher = typeof fetch;

interface MatchRef {
  id: number;
  slug: string;
  start_date: string;
}

interface MatchListResponse {
  results?: MatchRef[];
}

interface Team {
  name?: string;
}

interface Stream {
  raw_url?: string;
  official?: boolean;
  language?: string;
  blocked?: boolean;
}

interface MatchDetail {
  team1?: Team;
  team2?: Team;
  tournament?: { name?: string };
  start_date?: string;
  streams?: Stream[];
}

interface NaviMatch {
  opponent: string;
  tournament: string;
  startDate: Date;
  streamUrls: string[];
}

async function fetchJson<T>(url: string, fetchImpl: Fetcher): Promise<T> {
  const response = await fetchImpl(url, { headers: { "User-Agent": "brotag-bot/1.0" } });
  if (!response.ok) throw new Error(`bo3.gg API returned ${response.status} for ${url}`);
  return (await response.json()) as T;
}

async function fetchUpcomingMatchRefs(fetchImpl: Fetcher): Promise<MatchRef[]> {
  const urls = ["team1_id", "team2_id"].map(
    (field) =>
      `${BO3_API_URL}/matches?filter[matches.${field}][eq]=${NAVI_TEAM_ID}&filter[matches.status][eq]=upcoming&sort=start_date&page[limit]=${MAX_MATCHES}`,
  );
  const responses = await Promise.all(urls.map((url) => fetchJson<MatchListResponse>(url, fetchImpl)));
  const refs = responses.flatMap((r) => r.results ?? []);
  const uniqueById = new Map(refs.map((ref) => [ref.id, ref]));
  return [...uniqueById.values()]
    .sort((a, b) => Date.parse(a.start_date) - Date.parse(b.start_date))
    .slice(0, MAX_MATCHES);
}

function opponentName(detail: MatchDetail): string {
  const teams = [detail.team1?.name, detail.team2?.name].filter(
    (name): name is string => !!name && name !== "Natus Vincere",
  );
  return teams[0] ?? "TBD";
}

function streamUrlsFrom(detail: MatchDetail): string[] {
  const streams = (detail.streams ?? []).filter((s) => s.raw_url && !s.blocked);
  streams.sort((a, b) => Number(b.official ?? false) - Number(a.official ?? false));
  const unique = [...new Set(streams.map((s) => s.raw_url as string))];
  return unique.slice(0, 3);
}

async function fetchNaviMatches(refs: MatchRef[], fetchImpl: Fetcher): Promise<NaviMatch[]> {
  const details = await Promise.all(
    refs.map((ref) => fetchJson<MatchDetail>(`${BO3_API_URL}/matches/${ref.slug}`, fetchImpl)),
  );
  return details.map((detail, i) => ({
    opponent: opponentName(detail),
    tournament: detail.tournament?.name ?? "Невідомий турнір",
    startDate: new Date(detail.start_date ?? refs[i].start_date),
    streamUrls: streamUrlsFrom(detail),
  }));
}

const DATE_FORMATTER = new Intl.DateTimeFormat("uk-UA", {
  timeZone: "Europe/Kyiv",
  day: "2-digit",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

function formatMatch(match: NaviMatch): string {
  const when = `${DATE_FORMATTER.format(match.startDate)} (Київ)`;
  const streams = match.streamUrls.length > 0 ? match.streamUrls.join("\n") : "стрім поки не оголошено";
  return `🗓 ${when} — NAVI vs ${match.opponent}\n🏆 ${match.tournament}\n📺 ${streams}`;
}

export async function handleNaviSchedule(fetchImpl: Fetcher = fetch): Promise<string> {
  let matches: NaviMatch[];
  try {
    const refs = await fetchUpcomingMatchRefs(fetchImpl);
    if (refs.length === 0) {
      return "Найближчі матчі NAVI ще не визначені (турнірна сітка ще не сформована). Спробуй пізніше.";
    }
    matches = await fetchNaviMatches(refs, fetchImpl);
  } catch (err) {
    console.error("Failed to fetch NAVI schedule:", err);
    return "Не вдалося отримати календар матчів NAVI (bo3.gg API не відповідає). Спробуй пізніше.";
  }

  return `🟡🔵 Найближчі матчі NAVI:\n\n${matches.map(formatMatch).join("\n\n")}`;
}
