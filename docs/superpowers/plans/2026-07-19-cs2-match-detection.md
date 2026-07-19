# CS2 Match Detection & Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect new CS2 matches for enrolled group members by walking Steam share codes from a GitHub-Actions-triggered Vercel endpoint, queue each match in Supabase for the future render worker, and post one notification per new match in the group.

**Architecture:** A scheduled GitHub Actions workflow curls `POST /api/poll-matches` (bearer-protected) every 15 minutes. The route wraps `runMatchPoll` in `src/matchPoll.ts`, which walks `GetNextMatchSharingCode` for every active `cs2_tracking` row, advances `last_share_code`, dedupes into `match_queue` (unique per chat+share code, merging player lists), and sends grammY `Api` notifications. Enrollment is via `/trackcs2` which requires an existing Steam link from sub-project #1.

**Tech Stack:** TypeScript (ES2022, ESNext modules), grammY (`Api` class for webhook-less sends), `@supabase/supabase-js`, Vitest, Node built-in `fetch`, GitHub Actions cron.

## Global Constraints

- Zero new paid infrastructure: Vercel serverless + Supabase free tier + free GitHub Actions schedule.
- All new Telegram commands are group-only, replying "This command only works in a group." in a DM, matching every existing command in `src/bot.ts`.
- User-facing errors/messages are always short friendly lines; internals only in `console.error`.
- Store pattern: `Store` interface in `src/store/types.ts` implemented by `InMemoryStore` (unit-tested) and `SupabaseStore` (no direct unit tests — repo convention).
- New tables get RLS enabled in the same migration (bot uses service key which bypasses it).
- Steam auth failures (HTTP 401/403) mark tracking `broken` — never for transient errors (network, 5xx).
- Walk cap: at most 10 new share codes per user per poll cycle.
- New env vars: `STEAM_API_KEY`, `POLL_SECRET` (both already set in Vercel production and local `.env`; `POLL_SECRET` also in GitHub repo secrets).
- Poll endpoint: POST only, `Authorization: Bearer $POLL_SECRET`, returns 200 `{"checked":N,"newMatches":N,"brokenAuth":N}`; 401 on bad/missing token; 405 on non-POST.
- Steam help URL used in guides/notifications: `https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730&issueid=128`

---

### Task 1: Store layer for tracking and match queue

**Files:**
- Modify: `src/store/types.ts`
- Modify: `src/store/inMemoryStore.ts`
- Modify: `src/store/supabaseStore.ts`
- Create: `supabase/migrations/20260719120000_cs2_match_detection.sql`
- Modify: `supabase/schema.sql`
- Test: `tests/store/inMemoryStore.cs2.test.ts`

**Interfaces:**
- Consumes: existing `Store`/`InMemoryStore`/`SupabaseStore` structure, `memberKey` helper in inMemoryStore.
- Produces (used by Tasks 3 and 4):

```typescript
export interface Cs2Tracking {
  chatId: number;
  userId: number;
  authCode: string;
  lastShareCode: string;
  status: "active" | "broken";
}
```

Store methods:
- `setCs2Tracking(tracking: Cs2Tracking): Promise<void>` (upsert)
- `getCs2Tracking(chatId: number, userId: number): Promise<Cs2Tracking | undefined>`
- `deleteCs2Tracking(chatId: number, userId: number): Promise<void>`
- `listActiveCs2Tracking(): Promise<Cs2Tracking[]>` (all chats, `status === "active"` only)
- `updateCs2TrackingCode(chatId: number, userId: number, lastShareCode: string): Promise<void>`
- `markCs2TrackingBroken(chatId: number, userId: number): Promise<void>`
- `enqueueMatch(chatId: number, shareCode: string, playerIds: number[]): Promise<"inserted" | "merged">`

- [ ] **Step 1: Write the failing tests**

Create `tests/store/inMemoryStore.cs2.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../src/store/inMemoryStore";

const TRACKING = {
  chatId: 1,
  userId: 100,
  authCode: "AAAA-BBBBB-CCCC",
  lastShareCode: "CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee",
  status: "active" as const,
};

describe("InMemoryStore cs2 tracking", () => {
  it("sets and gets a tracking row", async () => {
    const store = new InMemoryStore();
    await store.setCs2Tracking(TRACKING);
    expect(await store.getCs2Tracking(1, 100)).toEqual(TRACKING);
  });

  it("returns undefined for unknown tracking", async () => {
    const store = new InMemoryStore();
    expect(await store.getCs2Tracking(1, 100)).toBeUndefined();
  });

  it("deletes a tracking row", async () => {
    const store = new InMemoryStore();
    await store.setCs2Tracking(TRACKING);
    await store.deleteCs2Tracking(1, 100);
    expect(await store.getCs2Tracking(1, 100)).toBeUndefined();
  });

  it("lists only active tracking rows across chats", async () => {
    const store = new InMemoryStore();
    await store.setCs2Tracking(TRACKING);
    await store.setCs2Tracking({ ...TRACKING, chatId: 2, userId: 200 });
    await store.setCs2Tracking({ ...TRACKING, chatId: 3, userId: 300, status: "broken" });
    const active = await store.listActiveCs2Tracking();
    expect(active.map((t) => t.chatId).sort()).toEqual([1, 2]);
  });

  it("advances the last share code", async () => {
    const store = new InMemoryStore();
    await store.setCs2Tracking(TRACKING);
    await store.updateCs2TrackingCode(1, 100, "CSGO-11111-22222-33333-44444-55555");
    expect((await store.getCs2Tracking(1, 100))!.lastShareCode).toBe(
      "CSGO-11111-22222-33333-44444-55555",
    );
  });

  it("marks tracking broken", async () => {
    const store = new InMemoryStore();
    await store.setCs2Tracking(TRACKING);
    await store.markCs2TrackingBroken(1, 100);
    expect((await store.getCs2Tracking(1, 100))!.status).toBe("broken");
    expect(await store.listActiveCs2Tracking()).toEqual([]);
  });

  it("re-enrolling resets a broken row to active", async () => {
    const store = new InMemoryStore();
    await store.setCs2Tracking(TRACKING);
    await store.markCs2TrackingBroken(1, 100);
    await store.setCs2Tracking(TRACKING);
    expect((await store.getCs2Tracking(1, 100))!.status).toBe("active");
  });
});

describe("InMemoryStore match queue", () => {
  const CODE = "CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee";

  it("inserts a new match", async () => {
    const store = new InMemoryStore();
    expect(await store.enqueueMatch(1, CODE, [100])).toBe("inserted");
  });

  it("merges a duplicate match in the same chat", async () => {
    const store = new InMemoryStore();
    await store.enqueueMatch(1, CODE, [100]);
    expect(await store.enqueueMatch(1, CODE, [200])).toBe("merged");
  });

  it("treats the same code in a different chat as a new match", async () => {
    const store = new InMemoryStore();
    await store.enqueueMatch(1, CODE, [100]);
    expect(await store.enqueueMatch(2, CODE, [100])).toBe("inserted");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/store/inMemoryStore.cs2.test.ts`
Expected: FAIL — `store.setCs2Tracking is not a function`

- [ ] **Step 3: Add the type and interface methods**

In `src/store/types.ts`, add after the `SteamLinkToken` interface:

```typescript
export interface Cs2Tracking {
  chatId: number;
  userId: number;
  authCode: string;
  lastShareCode: string;
  status: "active" | "broken";
}
```

Add to the `Store` interface, after `deleteSteamLink`:

```typescript
  setCs2Tracking(tracking: Cs2Tracking): Promise<void>;
  getCs2Tracking(chatId: number, userId: number): Promise<Cs2Tracking | undefined>;
  deleteCs2Tracking(chatId: number, userId: number): Promise<void>;
  listActiveCs2Tracking(): Promise<Cs2Tracking[]>;
  updateCs2TrackingCode(chatId: number, userId: number, lastShareCode: string): Promise<void>;
  markCs2TrackingBroken(chatId: number, userId: number): Promise<void>;

  enqueueMatch(chatId: number, shareCode: string, playerIds: number[]): Promise<"inserted" | "merged">;
```

- [ ] **Step 4: Implement in InMemoryStore**

In `src/store/inMemoryStore.ts`, update the import:

```typescript
import type { Cs2Tracking, Member, Role, SteamLinkToken, Store } from "./types.js";
```

Add private fields alongside `steamLinks`:

```typescript
  private cs2Tracking = new Map<string, Cs2Tracking>();
  private matchQueue = new Map<string, Set<number>>();
```

Add methods at the end of the class:

```typescript
  async setCs2Tracking(tracking: Cs2Tracking): Promise<void> {
    this.cs2Tracking.set(memberKey(tracking.chatId, tracking.userId), tracking);
  }

  async getCs2Tracking(chatId: number, userId: number): Promise<Cs2Tracking | undefined> {
    return this.cs2Tracking.get(memberKey(chatId, userId));
  }

  async deleteCs2Tracking(chatId: number, userId: number): Promise<void> {
    this.cs2Tracking.delete(memberKey(chatId, userId));
  }

  async listActiveCs2Tracking(): Promise<Cs2Tracking[]> {
    return [...this.cs2Tracking.values()].filter((t) => t.status === "active");
  }

  async updateCs2TrackingCode(chatId: number, userId: number, lastShareCode: string): Promise<void> {
    const existing = this.cs2Tracking.get(memberKey(chatId, userId));
    if (!existing) return;
    this.cs2Tracking.set(memberKey(chatId, userId), { ...existing, lastShareCode });
  }

  async markCs2TrackingBroken(chatId: number, userId: number): Promise<void> {
    const existing = this.cs2Tracking.get(memberKey(chatId, userId));
    if (!existing) return;
    this.cs2Tracking.set(memberKey(chatId, userId), { ...existing, status: "broken" });
  }

  async enqueueMatch(chatId: number, shareCode: string, playerIds: number[]): Promise<"inserted" | "merged"> {
    const key = `${chatId}:${shareCode}`;
    const existing = this.matchQueue.get(key);
    if (existing) {
      playerIds.forEach((id) => existing.add(id));
      return "merged";
    }
    this.matchQueue.set(key, new Set(playerIds));
    return "inserted";
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/store/inMemoryStore.cs2.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 6: Implement in SupabaseStore (no dedicated test, matching convention)**

In `src/store/supabaseStore.ts`, update the import:

```typescript
import type { Cs2Tracking, Member, Role, SteamLinkToken, Store } from "./types.js";
```

Add methods after `deleteSteamLink`:

```typescript
  async setCs2Tracking(tracking: Cs2Tracking): Promise<void> {
    const { error } = await this.client.from("cs2_tracking").upsert({
      chat_id: tracking.chatId,
      user_id: tracking.userId,
      auth_code: tracking.authCode,
      last_share_code: tracking.lastShareCode,
      status: tracking.status,
    });
    if (error) throw error;
  }

  async getCs2Tracking(chatId: number, userId: number): Promise<Cs2Tracking | undefined> {
    const { data, error } = await this.client
      .from("cs2_tracking")
      .select("*")
      .eq("chat_id", chatId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToCs2Tracking(data) : undefined;
  }

  async deleteCs2Tracking(chatId: number, userId: number): Promise<void> {
    const { error } = await this.client
      .from("cs2_tracking")
      .delete()
      .eq("chat_id", chatId)
      .eq("user_id", userId);
    if (error) throw error;
  }

  async listActiveCs2Tracking(): Promise<Cs2Tracking[]> {
    const { data, error } = await this.client.from("cs2_tracking").select("*").eq("status", "active");
    if (error) throw error;
    return (data ?? []).map(rowToCs2Tracking);
  }

  async updateCs2TrackingCode(chatId: number, userId: number, lastShareCode: string): Promise<void> {
    const { error } = await this.client
      .from("cs2_tracking")
      .update({ last_share_code: lastShareCode })
      .eq("chat_id", chatId)
      .eq("user_id", userId);
    if (error) throw error;
  }

  async markCs2TrackingBroken(chatId: number, userId: number): Promise<void> {
    const { error } = await this.client
      .from("cs2_tracking")
      .update({ status: "broken" })
      .eq("chat_id", chatId)
      .eq("user_id", userId);
    if (error) throw error;
  }

  async enqueueMatch(chatId: number, shareCode: string, playerIds: number[]): Promise<"inserted" | "merged"> {
    const { data: existing, error: selectError } = await this.client
      .from("match_queue")
      .select("id, player_ids")
      .eq("chat_id", chatId)
      .eq("share_code", shareCode)
      .maybeSingle();
    if (selectError) throw selectError;

    if (existing) {
      const merged = [...new Set([...(existing.player_ids ?? []), ...playerIds])];
      const { error } = await this.client.from("match_queue").update({ player_ids: merged }).eq("id", existing.id);
      if (error) throw error;
      return "merged";
    }

    const { error } = await this.client.from("match_queue").insert({
      chat_id: chatId,
      share_code: shareCode,
      player_ids: playerIds,
    });
    if (error) throw error;
    return "inserted";
  }
```

Add the row-mapping helper at the bottom, alongside `rowToSteamLinkToken`:

```typescript
function rowToCs2Tracking(row: any): Cs2Tracking {
  return {
    chatId: row.chat_id,
    userId: row.user_id,
    authCode: row.auth_code,
    lastShareCode: row.last_share_code,
    status: row.status,
  };
}
```

- [ ] **Step 7: Create the migration and update schema.sql**

Create `supabase/migrations/20260719120000_cs2_match_detection.sql`:

```sql
create table if not exists cs2_tracking (
  chat_id          bigint not null,
  user_id          bigint not null,
  auth_code        text not null,
  last_share_code  text not null,
  status           text not null default 'active',
  primary key (chat_id, user_id)
);

create table if not exists match_queue (
  id           bigserial primary key,
  chat_id      bigint not null,
  share_code   text not null,
  detected_at  timestamptz not null default now(),
  status       text not null default 'detected',
  player_ids   bigint[] not null,
  unique (chat_id, share_code)
);

alter table cs2_tracking enable row level security;
alter table match_queue enable row level security;
```

Append the same two `create table` blocks (without `if not exists`, matching the file's style) to `supabase/schema.sql`, and add the two `alter table ... enable row level security;` lines to the existing RLS block at the bottom of that file.

- [ ] **Step 8: Typecheck and run the full suite**

Run: `npm run typecheck && npm test`
Expected: both PASS

- [ ] **Step 9: Commit**

```bash
git add src/store/types.ts src/store/inMemoryStore.ts src/store/supabaseStore.ts supabase/schema.sql supabase/migrations/20260719120000_cs2_match_detection.sql tests/store/inMemoryStore.cs2.test.ts
git commit -m "feat: add cs2 tracking and match queue to the store layer"
```

---

### Task 2: Steam share-code client

**Files:**
- Create: `src/steamMatches.ts`
- Test: `tests/steamMatches.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure module).
- Produces (used by Task 3):

```typescript
export type NextCodeResult =
  | { kind: "next"; shareCode: string }
  | { kind: "upToDate" }
  | { kind: "authFailed" }
  | { kind: "error"; detail: string };

export async function getNextShareCode(
  apiKey: string,
  steamId64: string,
  authCode: string,
  knownCode: string,
  fetchImpl: typeof fetch,
): Promise<NextCodeResult>;

export const SHARE_CODE_PATTERN: RegExp; // matches CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx
```

- [ ] **Step 1: Write the failing tests**

Create `tests/steamMatches.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { getNextShareCode, SHARE_CODE_PATTERN } from "../src/steamMatches";

const ARGS = ["key123", "76561198000000000", "AAAA-BBBBB-CCCC", "CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee"] as const;

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

describe("getNextShareCode", () => {
  it("returns the next share code", async () => {
    const fetchImpl = mockFetch(200, { result: { nextcode: "CSGO-11111-22222-33333-44444-55555" } });
    const result = await getNextShareCode(...ARGS, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ kind: "next", shareCode: "CSGO-11111-22222-33333-44444-55555" });
    const url = (fetchImpl as any).mock.calls[0][0] as string;
    expect(url).toContain("ICSGOPlayers_730/GetNextMatchSharingCode/v1");
    expect(url).toContain("key=key123");
    expect(url).toContain("steamid=76561198000000000");
    expect(url).toContain("steamidkey=AAAA-BBBBB-CCCC");
    expect(url).toContain(`knowncode=${encodeURIComponent(ARGS[3])}`);
  });

  it("reports up-to-date when Steam returns n/a", async () => {
    const fetchImpl = mockFetch(200, { result: { nextcode: "n/a" } });
    expect(await getNextShareCode(...ARGS, fetchImpl as unknown as typeof fetch)).toEqual({ kind: "upToDate" });
  });

  it("reports up-to-date when the body has no nextcode", async () => {
    const fetchImpl = mockFetch(200, { result: {} });
    expect(await getNextShareCode(...ARGS, fetchImpl as unknown as typeof fetch)).toEqual({ kind: "upToDate" });
  });

  it.each([401, 403])("reports authFailed on HTTP %d", async (status) => {
    const fetchImpl = mockFetch(status, {});
    expect(await getNextShareCode(...ARGS, fetchImpl as unknown as typeof fetch)).toEqual({ kind: "authFailed" });
  });

  it("reports error on other HTTP failures", async () => {
    const fetchImpl = mockFetch(500, {});
    const result = await getNextShareCode(...ARGS, fetchImpl as unknown as typeof fetch);
    expect(result.kind).toBe("error");
  });

  it("reports error when fetch rejects", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("boom"));
    const result = await getNextShareCode(...ARGS, fetchImpl as unknown as typeof fetch);
    expect(result.kind).toBe("error");
  });
});

describe("SHARE_CODE_PATTERN", () => {
  it("accepts a well-formed share code", () => {
    expect(SHARE_CODE_PATTERN.test("CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee")).toBe(true);
  });

  it.each(["CSGO-aaaa-bbbbb-ccccc-ddddd-eeeee", "csgo-aaaaa-bbbbb-ccccc-ddddd-eeeee", "CSGO-aaaaa-bbbbb-ccccc-ddddd", "steam://CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee"])(
    "rejects %s",
    (code) => {
      expect(SHARE_CODE_PATTERN.test(code)).toBe(false);
    },
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/steamMatches.test.ts`
Expected: FAIL — `Cannot find module '../src/steamMatches'`

- [ ] **Step 3: Implement `src/steamMatches.ts`**

```typescript
const NEXT_CODE_ENDPOINT = "https://api.steampowered.com/ICSGOPlayers_730/GetNextMatchSharingCode/v1/";

export const SHARE_CODE_PATTERN = /^CSGO(-[A-Za-z0-9]{5}){5}$/;

export type NextCodeResult =
  | { kind: "next"; shareCode: string }
  | { kind: "upToDate" }
  | { kind: "authFailed" }
  | { kind: "error"; detail: string };

export async function getNextShareCode(
  apiKey: string,
  steamId64: string,
  authCode: string,
  knownCode: string,
  fetchImpl: typeof fetch,
): Promise<NextCodeResult> {
  const params = new URLSearchParams({
    key: apiKey,
    steamid: steamId64,
    steamidkey: authCode,
    knowncode: knownCode,
  });
  let response: { ok: boolean; status: number; json(): Promise<unknown> };
  try {
    response = await fetchImpl(`${NEXT_CODE_ENDPOINT}?${params.toString()}`);
  } catch (err) {
    return { kind: "error", detail: String(err) };
  }

  // Valve rejects a bad or expired steamidkey with 401/403; anything else
  // non-2xx (rate limit, outage) is transient and must not break tracking.
  if (response.status === 401 || response.status === 403) return { kind: "authFailed" };
  if (!response.ok) return { kind: "error", detail: `HTTP ${response.status}` };

  let body: any;
  try {
    body = await response.json();
  } catch (err) {
    return { kind: "error", detail: `bad JSON: ${String(err)}` };
  }
  const nextcode = body?.result?.nextcode;
  if (typeof nextcode === "string" && SHARE_CODE_PATTERN.test(nextcode)) {
    return { kind: "next", shareCode: nextcode };
  }
  return { kind: "upToDate" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/steamMatches.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
git add src/steamMatches.ts tests/steamMatches.test.ts
git commit -m "feat: add Steam next-share-code client"
```

---

### Task 3: Poll orchestration

**Files:**
- Create: `src/matchPoll.ts`
- Test: `tests/matchPoll.test.ts`

**Interfaces:**
- Consumes: `Store` methods from Task 1 (`listActiveCs2Tracking`, `updateCs2TrackingCode`, `markCs2TrackingBroken`, `enqueueMatch`, plus existing `getSteamLink`, `getMember`); `getNextShareCode`/`NextCodeResult` from Task 2.
- Produces (used by Task 6):

```typescript
export interface PollSummary { checked: number; newMatches: number; brokenAuth: number }
export type Notify = (chatId: number, text: string) => Promise<void>;
export async function runMatchPoll(
  store: Store,
  steamApiKey: string,
  fetchImpl: typeof fetch,
  notify: Notify,
): Promise<PollSummary>;
```

- [ ] **Step 1: Write the failing tests**

Create `tests/matchPoll.test.ts`:

```typescript
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/matchPoll.test.ts`
Expected: FAIL — `Cannot find module '../src/matchPoll'`

- [ ] **Step 3: Implement `src/matchPoll.ts`**

```typescript
import type { Store } from "./store/types.js";
import { getNextShareCode } from "./steamMatches.js";

const MAX_CODES_PER_USER_PER_CYCLE = 10;
const STEAM_HELP_URL = "https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730&issueid=128";

export interface PollSummary {
  checked: number;
  newMatches: number;
  brokenAuth: number;
}

export type Notify = (chatId: number, text: string) => Promise<void>;

async function memberName(store: Store, chatId: number, userId: number): Promise<string> {
  const member = await store.getMember(chatId, userId);
  return member?.firstName ?? "someone";
}

async function safeNotify(notify: Notify, chatId: number, text: string): Promise<void> {
  try {
    await notify(chatId, text);
  } catch (err) {
    console.error("Failed to send match notification:", err);
  }
}

export async function runMatchPoll(
  store: Store,
  steamApiKey: string,
  fetchImpl: typeof fetch,
  notify: Notify,
): Promise<PollSummary> {
  const tracked = await store.listActiveCs2Tracking();
  const summary: PollSummary = { checked: tracked.length, newMatches: 0, brokenAuth: 0 };
  // (chatId -> shareCode -> userIds) collected across the whole sweep so that
  // two users who played the same match produce one queue row and one message.
  const found = new Map<number, Map<string, Set<number>>>();

  for (const tracking of tracked) {
    const steamId64 = await store.getSteamLink(tracking.chatId, tracking.userId);
    if (!steamId64) {
      await store.markCs2TrackingBroken(tracking.chatId, tracking.userId);
      summary.brokenAuth++;
      const name = await memberName(store, tracking.chatId, tracking.userId);
      await safeNotify(
        notify,
        tracking.chatId,
        `⚠️ ${name}, your Steam link is gone — run /linksteam and /trackcs2 again.`,
      );
      continue;
    }

    let knownCode = tracking.lastShareCode;
    for (let i = 0; i < MAX_CODES_PER_USER_PER_CYCLE; i++) {
      const result = await getNextShareCode(steamApiKey, steamId64, tracking.authCode, knownCode, fetchImpl);
      if (result.kind === "next") {
        knownCode = result.shareCode;
        await store.updateCs2TrackingCode(tracking.chatId, tracking.userId, knownCode);
        const chatMatches = found.get(tracking.chatId) ?? new Map<string, Set<number>>();
        const players = chatMatches.get(knownCode) ?? new Set<number>();
        players.add(tracking.userId);
        chatMatches.set(knownCode, players);
        found.set(tracking.chatId, chatMatches);
        continue;
      }
      if (result.kind === "authFailed") {
        await store.markCs2TrackingBroken(tracking.chatId, tracking.userId);
        summary.brokenAuth++;
        const name = await memberName(store, tracking.chatId, tracking.userId);
        await safeNotify(
          notify,
          tracking.chatId,
          `⚠️ ${name}, your CS2 auth code stopped working. Create a new one and re-run /trackcs2: ${STEAM_HELP_URL}`,
        );
      } else if (result.kind === "error") {
        console.error(
          `Steam poll error for chat ${tracking.chatId} user ${tracking.userId}: ${result.detail}`,
        );
      }
      break;
    }
  }

  for (const [chatId, matches] of found) {
    for (const [shareCode, players] of matches) {
      const outcome = await store.enqueueMatch(chatId, shareCode, [...players]);
      if (outcome !== "inserted") continue;
      summary.newMatches++;
      const names = await Promise.all([...players].map((id) => memberName(store, chatId, id)));
      await safeNotify(notify, chatId, `🎮 New match detected for ${names.join(", ")} — queued for highlights.`);
    }
  }

  return summary;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/matchPoll.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/matchPoll.ts tests/matchPoll.test.ts
git commit -m "feat: add cs2 match poll orchestration with dedupe and notifications"
```

---

### Task 4: Enrollment commands

**Files:**
- Create: `src/commands/cs2Commands.ts`
- Modify: `src/commands/steamCommands.ts` (extend `handleMySteam`)
- Test: `tests/commands/cs2Commands.test.ts`
- Modify: `tests/commands/steamCommands.test.ts` (update `handleMySteam` expectations)

**Interfaces:**
- Consumes: `Store` methods from Task 1; `SHARE_CODE_PATTERN` from Task 2; existing `getSteamLink`.
- Produces (used by Task 5):
  - `handleTrackCs2(store: Store, chatId: number, userId: number, args: string): Promise<string>`
  - `handleUntrackCs2(store: Store, chatId: number, userId: number): Promise<string>`
  - `TRACKCS2_GUIDE: string` (exported for reuse in tests)

- [ ] **Step 1: Write the failing tests**

Create `tests/commands/cs2Commands.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../src/store/inMemoryStore";
import { handleTrackCs2, handleUntrackCs2, TRACKCS2_GUIDE } from "../../src/commands/cs2Commands";

const AUTH = "AAAA-BBBBB-CCCC";
const CODE = "CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee";

describe("handleTrackCs2", () => {
  it("requires a linked steam account", async () => {
    const store = new InMemoryStore();
    const reply = await handleTrackCs2(store, 1, 100, `${AUTH} ${CODE}`);
    expect(reply).toBe("Link your Steam account first with /linksteam.");
  });

  it("replies with the guide when args are missing", async () => {
    const store = new InMemoryStore();
    await store.setSteamLink(1, 100, "76561198000000000");
    expect(await handleTrackCs2(store, 1, 100, "")).toBe(TRACKCS2_GUIDE);
  });

  it.each([
    ["bad auth code", `WRONG ${"CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee"}`],
    ["bad share code", `${"AAAA-BBBBB-CCCC"} CSGO-nope`],
  ])("replies with the guide on %s", async (_label, args) => {
    const store = new InMemoryStore();
    await store.setSteamLink(1, 100, "76561198000000000");
    expect(await handleTrackCs2(store, 1, 100, args)).toBe(TRACKCS2_GUIDE);
  });

  it("enrolls with valid codes and confirms", async () => {
    const store = new InMemoryStore();
    await store.setSteamLink(1, 100, "76561198000000000");
    const reply = await handleTrackCs2(store, 1, 100, `${AUTH} ${CODE}`);
    expect(reply).toBe("CS2 match tracking is on. New matches are detected within ~15 minutes.");
    expect(await store.getCs2Tracking(1, 100)).toEqual({
      chatId: 1,
      userId: 100,
      authCode: AUTH,
      lastShareCode: CODE,
      status: "active",
    });
  });

  it("re-enrolling resets a broken row", async () => {
    const store = new InMemoryStore();
    await store.setSteamLink(1, 100, "76561198000000000");
    await handleTrackCs2(store, 1, 100, `${AUTH} ${CODE}`);
    await store.markCs2TrackingBroken(1, 100);
    await handleTrackCs2(store, 1, 100, `${AUTH} ${CODE}`);
    expect((await store.getCs2Tracking(1, 100))!.status).toBe("active");
  });
});

describe("handleUntrackCs2", () => {
  it("removes tracking", async () => {
    const store = new InMemoryStore();
    await store.setSteamLink(1, 100, "76561198000000000");
    await handleTrackCs2(store, 1, 100, `${AUTH} ${CODE}`);
    expect(await handleUntrackCs2(store, 1, 100)).toBe("CS2 match tracking is off.");
    expect(await store.getCs2Tracking(1, 100)).toBeUndefined();
  });

  it("reports when nothing was tracked", async () => {
    const store = new InMemoryStore();
    expect(await handleUntrackCs2(store, 1, 100)).toBe("You weren't tracking CS2 matches.");
  });
});
```

In `tests/commands/steamCommands.test.ts`, replace the existing `handleMySteam` "reports the linked profile" test with:

```typescript
  it("reports the linked profile and tracking status", async () => {
    const store = new InMemoryStore();
    await store.setSteamLink(1, 100, "76561198000000000");
    const reply = await handleMySteam(store, 1, 100);
    expect(reply).toBe(
      "Your linked Steam account: https://steamcommunity.com/profiles/76561198000000000\nCS2 tracking: off — use /trackcs2 to get match highlights.",
    );
  });

  it("reports active tracking", async () => {
    const store = new InMemoryStore();
    await store.setSteamLink(1, 100, "76561198000000000");
    await store.setCs2Tracking({
      chatId: 1,
      userId: 100,
      authCode: "AAAA-BBBBB-CCCC",
      lastShareCode: "CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee",
      status: "active",
    });
    const reply = await handleMySteam(store, 1, 100);
    expect(reply).toContain("CS2 tracking: on");
  });

  it("reports broken tracking", async () => {
    const store = new InMemoryStore();
    await store.setSteamLink(1, 100, "76561198000000000");
    await store.setCs2Tracking({
      chatId: 1,
      userId: 100,
      authCode: "AAAA-BBBBB-CCCC",
      lastShareCode: "CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee",
      status: "broken",
    });
    const reply = await handleMySteam(store, 1, 100);
    expect(reply).toContain("CS2 tracking: broken — re-run /trackcs2");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/commands/cs2Commands.test.ts tests/commands/steamCommands.test.ts`
Expected: FAIL — `Cannot find module '../../src/commands/cs2Commands'` and the updated `handleMySteam` assertions fail.

- [ ] **Step 3: Implement `src/commands/cs2Commands.ts`**

```typescript
import type { Store } from "../store/types.js";
import { SHARE_CODE_PATTERN } from "../steamMatches.js";

const AUTH_CODE_PATTERN = /^[A-Za-z0-9]{4}-[A-Za-z0-9]{5}-[A-Za-z0-9]{4}$/;

export const TRACKCS2_GUIDE = `To track your CS2 matches:
1. Open https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730&issueid=128 (sign in with the Steam account you linked).
2. Click "Create authentication code" — that's your auth code (XXXX-XXXXX-XXXX).
3. The same page shows "Your most recently completed match token" — that's your share code (CSGO-...).
4. Run /trackcs2 <auth-code> <share-code>`;

export async function handleTrackCs2(
  store: Store,
  chatId: number,
  userId: number,
  args: string,
): Promise<string> {
  const steamId64 = await store.getSteamLink(chatId, userId);
  if (!steamId64) return "Link your Steam account first with /linksteam.";

  const tokens = args.split(/\s+/).filter(Boolean);
  if (tokens.length !== 2) return TRACKCS2_GUIDE;
  const [authCode, shareCode] = tokens;
  if (!AUTH_CODE_PATTERN.test(authCode) || !SHARE_CODE_PATTERN.test(shareCode)) {
    return TRACKCS2_GUIDE;
  }

  await store.setCs2Tracking({ chatId, userId, authCode, lastShareCode: shareCode, status: "active" });
  return "CS2 match tracking is on. New matches are detected within ~15 minutes.";
}

export async function handleUntrackCs2(store: Store, chatId: number, userId: number): Promise<string> {
  const existing = await store.getCs2Tracking(chatId, userId);
  if (!existing) return "You weren't tracking CS2 matches.";
  await store.deleteCs2Tracking(chatId, userId);
  return "CS2 match tracking is off.";
}
```

In `src/commands/steamCommands.ts`, replace `handleMySteam` with:

```typescript
export async function handleMySteam(store: Store, chatId: number, userId: number): Promise<string> {
  const steamId64 = await store.getSteamLink(chatId, userId);
  if (!steamId64) return "You haven't linked a Steam account yet — run /linksteam.";
  const tracking = await store.getCs2Tracking(chatId, userId);
  const trackingLine =
    tracking === undefined
      ? "CS2 tracking: off — use /trackcs2 to get match highlights."
      : tracking.status === "active"
        ? "CS2 tracking: on."
        : "CS2 tracking: broken — re-run /trackcs2.";
  return `Your linked Steam account: https://steamcommunity.com/profiles/${steamId64}\n${trackingLine}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/commands/cs2Commands.test.ts tests/commands/steamCommands.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/cs2Commands.ts src/commands/steamCommands.ts tests/commands/cs2Commands.test.ts tests/commands/steamCommands.test.ts
git commit -m "feat: add /trackcs2 and /untrackcs2 handlers and tracking status in /mysteam"
```

---

### Task 5: Bot wiring

**Files:**
- Modify: `src/bot.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `handleTrackCs2`, `handleUntrackCs2` from Task 4.
- Produces: nothing new — `createBot(token, store, publicUrl)` signature unchanged.

No dedicated test file (repo convention: bot.ts wiring is verified via typecheck + full suite).

- [ ] **Step 1: Wire the commands into `src/bot.ts`**

Add the import near the other command imports:

```typescript
import { handleTrackCs2, handleUntrackCs2 } from "./commands/cs2Commands.js";
```

Add after the `unlinksteam` command block and before the `help`/`commands` block:

```typescript
  bot.command("trackcs2", async (ctx) => {
    if (!isGroupChat(ctx.chat.type)) return ctx.reply("This command only works in a group.");
    if (!ctx.from) return;
    return ctx.reply(await handleTrackCs2(store, ctx.chat.id, ctx.from.id, ctx.match.trim()));
  });

  bot.command("untrackcs2", async (ctx) => {
    if (!isGroupChat(ctx.chat.type)) return ctx.reply("This command only works in a group.");
    if (!ctx.from) return;
    return ctx.reply(await handleUntrackCs2(store, ctx.chat.id, ctx.from.id));
  });
```

Add to `HELP_TEXT`, after the `/unlinksteam` line and before `/help`:

```
/trackcs2 <auth-code> <share-code> - track your CS2 matches for highlights (run bare for setup instructions)
/untrackcs2 - stop tracking your CS2 matches
```

- [ ] **Step 2: Add the new env vars to `.env.example`**

```
BOT_TOKEN=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
WEBHOOK_URL=
PUBLIC_URL=
STEAM_API_KEY=
POLL_SECRET=
```

- [ ] **Step 3: Typecheck and run the full suite**

Run: `npm run typecheck && npm test`
Expected: both PASS

- [ ] **Step 4: Commit**

```bash
git add src/bot.ts .env.example
git commit -m "feat: wire /trackcs2 and /untrackcs2 into the bot"
```

---

### Task 6: Poll endpoint and GitHub Actions trigger

**Files:**
- Create: `api/poll-matches.ts`
- Create: `.github/workflows/poll-matches.yml`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: `runMatchPoll`, `Notify` from Task 3; `SupabaseStore` from the store layer; grammY `Api`.
- Produces: nothing consumed later in this plan — final task.

No dedicated test file: like the other `api/` routes, this is a thin wrapper; all logic is covered by Task 3's tests. Verified via typecheck plus the manual steps below.

- [ ] **Step 1: Implement `api/poll-matches.ts`**

```typescript
import { Api } from "grammy";
import type { IncomingMessage, ServerResponse } from "http";
import { SupabaseStore } from "../src/store/supabaseStore.js";
import { runMatchPoll } from "../src/matchPoll.js";

const botToken = process.env.BOT_TOKEN;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const steamApiKey = process.env.STEAM_API_KEY;
const pollSecret = process.env.POLL_SECRET;

if (!botToken || !supabaseUrl || !supabaseKey || !steamApiKey || !pollSecret) {
  throw new Error(
    "Missing BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STEAM_API_KEY, or POLL_SECRET environment variable",
  );
}

const store = new SupabaseStore(supabaseUrl, supabaseKey);
const api = new Api(botToken as string);
const notify = async (chatId: number, text: string) => {
  await api.sendMessage(chatId, text);
};

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end();
  }
  if (req.headers.authorization !== `Bearer ${pollSecret}`) {
    res.statusCode = 401;
    return res.end();
  }

  try {
    const summary = await runMatchPoll(store, steamApiKey as string, fetch, notify);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(summary));
  } catch (err) {
    console.error("Error running match poll:", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "poll failed" }));
    }
  }
}
```

Note on `as string` casts: `steamApiKey` and `pollSecret` are referenced inside `handler`/`notify` closures where TS control-flow narrowing from the module-scope guard is lost — same pattern as `publicUrl` in `api/steam-link/start.ts`. `botToken` is used at module scope for `new Api(...)` after the guard but TS 5.5 keeps narrowing only for module-scope reads; if `tsc` accepts it without the cast, drop the cast.

- [ ] **Step 2: Create `.github/workflows/poll-matches.yml`**

```yaml
name: Poll CS2 matches

on:
  schedule:
    - cron: "*/15 * * * *"
  workflow_dispatch:

jobs:
  poll:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger poll endpoint
        run: |
          curl -sf -X POST "https://brotag.vercel.app/api/poll-matches" \
            -H "Authorization: Bearer ${{ secrets.POLL_SECRET }}"
```

- [ ] **Step 3: Register the route in `vercel.json`**

```json
{
  "functions": {
    "api/webhook.ts": {
      "maxDuration": 10
    },
    "api/steam-link/start.ts": {
      "maxDuration": 10
    },
    "api/steam-link/callback.ts": {
      "maxDuration": 10
    },
    "api/poll-matches.ts": {
      "maxDuration": 10
    }
  }
}
```

- [ ] **Step 4: Typecheck and run the full suite**

Run: `npm run typecheck && npm test`
Expected: both PASS

- [ ] **Step 5: Commit**

```bash
git add api/poll-matches.ts .github/workflows/poll-matches.yml vercel.json
git commit -m "feat: add bearer-protected poll endpoint and GitHub Actions schedule"
```

- [ ] **Step 6: Post-merge deployment steps (manual, after merging to main)**

1. Apply the migration to the production database:
   `npx supabase db push --db-url "postgresql://postgres.wifyevxgnbxsewiaszla:<DB_PASSWORD_URLENCODED>@aws-1-eu-west-2.pooler.supabase.com:5432/postgres"`
2. Push main to origin — Vercel auto-deploys, and the workflow file becomes active on GitHub.
3. Verify endpoint auth: `curl -s -o /dev/null -w "%{http_code}" -X POST https://brotag.vercel.app/api/poll-matches` → expect `401`; with `-H "Authorization: Bearer $POLL_SECRET"` → expect `200` with `{"checked":0,...}` (nobody enrolled yet).
4. Trigger the workflow manually from the GitHub Actions tab (workflow_dispatch) and confirm a green run.
5. In the Telegram group: `/trackcs2` bare → guide appears; enroll with real codes → confirmation; play a match (or wait) → notification appears and a `match_queue` row exists.
6. Capture the real Steam response shapes observed in Vercel logs; if the "no newer match" or auth-failure responses differ from the assumptions in `src/steamMatches.ts` (`result.nextcode === "n/a"`, HTTP 401/403), file the discrepancy and adjust the client.
