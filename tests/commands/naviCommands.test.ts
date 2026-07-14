import { describe, it, expect, vi } from "vitest";
import { handleNaviSchedule } from "../../src/commands/naviCommands";

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response;
}

const UPCOMING_LIST = {
  results: [{ id: 1, slug: "natus-vincere-vs-faze-20-07-2026", start_date: "2026-07-20T14:00:00.000+00:00" }],
};

const MATCH_DETAIL = {
  team1: { name: "Natus Vincere" },
  team2: { name: "FaZe" },
  tournament: { name: "IEM Cologne 2026" },
  start_date: "2026-07-20T14:00:00.000+00:00",
  streams: [
    { raw_url: "https://twitch.tv/faze", official: false, blocked: false },
    { raw_url: "https://twitch.tv/eslcs", official: true, blocked: false },
  ],
};

function fakeFetch(opts: { list?: unknown; detail?: unknown; listOk?: boolean; detailOk?: boolean } = {}): typeof fetch {
  const { list = UPCOMING_LIST, detail = MATCH_DETAIL, listOk = true, detailOk = true } = opts;
  return vi.fn(async (url: string | URL) => {
    const href = url.toString();
    if (href.includes("/matches?")) return jsonResponse(list, listOk);
    if (href.includes("/matches/")) return jsonResponse(detail, detailOk);
    throw new Error(`Unexpected fetch: ${href}`);
  }) as unknown as typeof fetch;
}

describe("handleNaviSchedule", () => {
  it("reports when no upcoming matches are scheduled yet", async () => {
    const fetchImpl = fakeFetch({ list: { results: [] } });
    const reply = await handleNaviSchedule(fetchImpl);
    expect(reply).toBe("Найближчі матчі NAVI ще не визначені (турнірна сітка ще не сформована). Спробуй пізніше.");
  });

  it("lists the opponent, tournament, and official-first stream links", async () => {
    const fetchImpl = fakeFetch();
    const reply = await handleNaviSchedule(fetchImpl);

    expect(reply).toContain("NAVI vs FaZe");
    expect(reply).toContain("IEM Cologne 2026");
    expect(reply).toContain("https://twitch.tv/eslcs");
    expect(reply).toContain("https://twitch.tv/faze");
    expect(reply.indexOf("https://twitch.tv/eslcs")).toBeLessThan(reply.indexOf("https://twitch.tv/faze"));
  });

  it("says no stream is announced yet when the streams list is empty", async () => {
    const fetchImpl = fakeFetch({ detail: { ...MATCH_DETAIL, streams: [] } });
    const reply = await handleNaviSchedule(fetchImpl);
    expect(reply).toContain("стрім поки не оголошено");
  });

  it("falls back gracefully when the match list request fails", async () => {
    const fetchImpl = fakeFetch({ listOk: false });
    const reply = await handleNaviSchedule(fetchImpl);
    expect(reply).toBe("Не вдалося отримати календар матчів NAVI (bo3.gg API не відповідає). Спробуй пізніше.");
  });

  it("falls back gracefully when a match detail request fails", async () => {
    const fetchImpl = fakeFetch({ detailOk: false });
    const reply = await handleNaviSchedule(fetchImpl);
    expect(reply).toBe("Не вдалося отримати календар матчів NAVI (bo3.gg API не відповідає). Спробуй пізніше.");
  });

  it("deduplicates a match that matches both the team1 and team2 queries", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = url.toString();
      if (href.includes("team1_id")) return jsonResponse(UPCOMING_LIST);
      if (href.includes("team2_id")) return jsonResponse(UPCOMING_LIST);
      return jsonResponse(MATCH_DETAIL);
    }) as unknown as typeof fetch;

    const reply = await handleNaviSchedule(fetchImpl);
    const occurrences = reply.split("IEM Cologne 2026").length - 1;
    expect(occurrences).toBe(1);
  });
});
