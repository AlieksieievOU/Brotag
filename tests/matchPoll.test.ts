import { describe, it, expect, vi } from "vitest";
import { InMemoryStore } from "../src/store/inMemoryStore";
import { runMatchPoll } from "../src/matchPoll";

const CODE0 = "CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee";
const CODE1 = "CSGO-11111-22222-33333-44444-55555";
const CODE2 = "CSGO-66666-77777-88888-99999-00000";

async function setupUser(store: InMemoryStore, chatId: number, userId: number, name: string) {
  await store.upsertMember({ chatId, userId, firstName: name });
  await store.setSteamLink(chatId, userId, String(76561198000000000 + userId));
  await store.setCs2Tracking({
    chatId,
    userId,
    authCode: "AAAA-BBBBB-CCCC",
    lastShareCode: CODE0,
    status: "active",
  });
}

// Builds a fetch mock that yields each result in sequence per steamid, then upToDate.
function steamFetch(sequences: Record<string, Array<{ status?: number; nextcode?: string }>>) {
  return vi.fn().mockImplementation(async (url: string) => {
    const steamid = new URL(url).searchParams.get("steamid")!;
    const queue = sequences[steamid] ?? [];
    const step = queue.shift() ?? { nextcode: "n/a" };
    const status = step.status ?? 200;
    return {
      ok: status < 300,
      status,
      json: async () => ({ result: { nextcode: step.nextcode ?? "n/a" } }),
    };
  });
}

describe("runMatchPoll", () => {
  it("walks new codes, queues them, advances tracking, and notifies once per match", async () => {
    const store = new InMemoryStore();
    await setupUser(store, 1, 100, "Ada");
    const fetchImpl = steamFetch({ "76561198000000100": [{ nextcode: CODE1 }, { nextcode: CODE2 }] });
    const sent: Array<{ chatId: number; text: string }> = [];
    const notify = async (chatId: number, text: string) => { sent.push({ chatId, text }); };

    const summary = await runMatchPoll(store, "key", fetchImpl as unknown as typeof fetch, notify);

    expect(summary).toEqual({ checked: 1, newMatches: 2, brokenAuth: 0 });
    expect((await store.getCs2Tracking(1, 100))!.lastShareCode).toBe(CODE2);
    expect(sent).toHaveLength(2);
    expect(sent[0].chatId).toBe(1);
    expect(sent[0].text).toContain("Ada");
  });

  it("sends one notification when two users hit the same match", async () => {
    const store = new InMemoryStore();
    await setupUser(store, 1, 100, "Ada");
    await setupUser(store, 1, 200, "Max");
    const fetchImpl = steamFetch({
      "76561198000000100": [{ nextcode: CODE1 }],
      "76561198000000200": [{ nextcode: CODE1 }],
    });
    const sent: string[] = [];
    const notify = async (_chatId: number, text: string) => { sent.push(text); };

    const summary = await runMatchPoll(store, "key", fetchImpl as unknown as typeof fetch, notify);

    expect(summary.newMatches).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Ada");
    expect(sent[0]).toContain("Max");
  });

  it("marks tracking broken on auth failure and notifies with the help link", async () => {
    const store = new InMemoryStore();
    await setupUser(store, 1, 100, "Ada");
    const fetchImpl = steamFetch({ "76561198000000100": [{ status: 403 }] });
    const sent: string[] = [];
    const notify = async (_chatId: number, text: string) => { sent.push(text); };

    const summary = await runMatchPoll(store, "key", fetchImpl as unknown as typeof fetch, notify);

    expect(summary).toEqual({ checked: 1, newMatches: 0, brokenAuth: 1 });
    expect((await store.getCs2Tracking(1, 100))!.status).toBe("broken");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("help.steampowered.com");
  });

  it("skips transient errors without marking broken or notifying", async () => {
    const store = new InMemoryStore();
    await setupUser(store, 1, 100, "Ada");
    const fetchImpl = steamFetch({ "76561198000000100": [{ status: 500 }] });
    const sent: string[] = [];
    const notify = async (_chatId: number, text: string) => { sent.push(text); };

    const summary = await runMatchPoll(store, "key", fetchImpl as unknown as typeof fetch, notify);

    expect(summary).toEqual({ checked: 1, newMatches: 0, brokenAuth: 0 });
    expect((await store.getCs2Tracking(1, 100))!.status).toBe("active");
    expect(sent).toHaveLength(0);
  });

  it("marks broken when the steam link is missing", async () => {
    const store = new InMemoryStore();
    await setupUser(store, 1, 100, "Ada");
    await store.deleteSteamLink(1, 100);
    const fetchImpl = vi.fn();
    const sent: string[] = [];
    const notify = async (_chatId: number, text: string) => { sent.push(text); };

    const summary = await runMatchPoll(store, "key", fetchImpl as unknown as typeof fetch, notify);

    expect(summary.brokenAuth).toBe(1);
    expect((await store.getCs2Tracking(1, 100))!.status).toBe("broken");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
  });

  it("caps the walk at 10 codes per user per cycle", async () => {
    const store = new InMemoryStore();
    await setupUser(store, 1, 100, "Ada");
    // 12 distinct codes queued; only 10 may be consumed.
    const codes = Array.from({ length: 12 }, (_, i) => {
      const block = String(i).padStart(5, "0");
      return { nextcode: `CSGO-${block}-${block}-${block}-${block}-${block}` };
    });
    const fetchImpl = steamFetch({ "76561198000000100": codes });
    const notify = async () => {};

    const summary = await runMatchPoll(store, "key", fetchImpl as unknown as typeof fetch, notify);

    expect(summary.newMatches).toBe(10);
  });

  it("continues with other users when one user's notify throws", async () => {
    const store = new InMemoryStore();
    await setupUser(store, 1, 100, "Ada");
    await setupUser(store, 2, 200, "Max");
    const fetchImpl = steamFetch({
      "76561198000000100": [{ nextcode: CODE1 }],
      "76561198000000200": [{ nextcode: CODE2 }],
    });
    const notify = vi.fn().mockRejectedValueOnce(new Error("telegram down")).mockResolvedValue(undefined);

    const summary = await runMatchPoll(store, "key", fetchImpl as unknown as typeof fetch, notify);

    expect(summary.newMatches).toBe(2);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("enqueues each match before advancing the tracking cursor past it", async () => {
    class RecordingStore extends InMemoryStore {
      calls: Array<{ kind: "enqueueMatch" | "updateCs2TrackingCode"; shareCode: string }> = [];

      async enqueueMatch(chatId: number, shareCode: string, playerIds: number[]): Promise<"inserted" | "merged"> {
        this.calls.push({ kind: "enqueueMatch", shareCode });
        return super.enqueueMatch(chatId, shareCode, playerIds);
      }

      async updateCs2TrackingCode(chatId: number, userId: number, lastShareCode: string): Promise<void> {
        this.calls.push({ kind: "updateCs2TrackingCode", shareCode: lastShareCode });
        return super.updateCs2TrackingCode(chatId, userId, lastShareCode);
      }
    }

    const store = new RecordingStore();
    await setupUser(store, 1, 100, "Ada");
    const fetchImpl = steamFetch({ "76561198000000100": [{ nextcode: CODE1 }, { nextcode: CODE2 }] });
    const notify = async () => {};

    const summary = await runMatchPoll(store, "key", fetchImpl as unknown as typeof fetch, notify);

    expect(summary.newMatches).toBe(2);
    for (const code of [CODE1, CODE2]) {
      const enqueueIdx = store.calls.findIndex((c) => c.kind === "enqueueMatch" && c.shareCode === code);
      const updateIdx = store.calls.findIndex((c) => c.kind === "updateCs2TrackingCode" && c.shareCode === code);
      expect(enqueueIdx).toBeGreaterThanOrEqual(0);
      expect(updateIdx).toBeGreaterThanOrEqual(0);
      expect(enqueueIdx).toBeLessThan(updateIdx);
    }
  });
});
