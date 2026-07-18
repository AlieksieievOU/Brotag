# Steam Account Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Telegram group member run `/linksteam`, verify ownership of a Steam account via Steam's own OpenID login, and store that link scoped to `(chat_id, telegram_user_id)`, so a later sub-project can use it to look up matches.

**Architecture:** Two new Vercel serverless routes (`api/steam-link/start.ts`, `api/steam-link/callback.ts`) drive the Steam OpenID 2.0 redirect/verify flow. All the actual logic (token issuance, OpenID URL building, response verification, linking) lives in plain testable functions under `src/`; the API routes and `bot.ts` command handlers are thin wrappers around them, matching how `api/webhook.ts` already just wraps `createBot`.

**Tech Stack:** TypeScript (ES2022, ESNext modules), grammY (Telegram bot framework), `@supabase/supabase-js`, Vitest, Node's built-in `fetch` and `crypto.randomBytes`.

## Global Constraints

- Zero new infrastructure: everything runs on the existing Vercel serverless deployment and Supabase Postgres free tier.
- All new Telegram commands are group-only, replying "This command only works in a group." in a DM, matching every existing command in `src/bot.ts`.
- User-facing errors are always a short, friendly line — never a stack trace or raw error detail (those go to `console.error` only).
- Link tokens are single-use and expire after 10 minutes.
- A link is scoped per `(chat_id, user_id)` — the same Telegram user can have different (or no) Steam links in different groups, mirroring how `members`/`roles` are already scoped per `chat_id`.
- Follow the existing store pattern exactly: the `Store` interface in `src/store/types.ts` is implemented by both `InMemoryStore` (used in tests) and `SupabaseStore` (used in production); only `InMemoryStore` gets direct unit tests, matching the existing convention (`SupabaseStore` is never unit-tested in this repo).
- New required env var: `PUBLIC_URL` (e.g. `https://brotag.vercel.app`) — the externally-reachable base URL of the deployment, needed to build the Steam OpenID `return_to`/`realm` and the link sent to users.

---

### Task 1: Steam link data model (types + InMemoryStore + SupabaseStore + schema)

**Files:**
- Modify: `src/store/types.ts`
- Modify: `src/store/inMemoryStore.ts`
- Modify: `src/store/supabaseStore.ts`
- Modify: `supabase/schema.sql`
- Test: `tests/store/inMemoryStore.steam.test.ts`

**Interfaces:**
- Produces: `SteamLinkToken { token: string; chatId: number; userId: number; expiresAt: number }` (exported from `src/store/types.ts`), and these `Store` methods, used by every later task:
  - `createSteamLinkToken(record: SteamLinkToken): Promise<void>`
  - `getSteamLinkToken(token: string): Promise<SteamLinkToken | undefined>`
  - `deleteSteamLinkToken(token: string): Promise<void>`
  - `setSteamLink(chatId: number, userId: number, steamId64: string): Promise<void>`
  - `getSteamLink(chatId: number, userId: number): Promise<string | undefined>`
  - `deleteSteamLink(chatId: number, userId: number): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Create `tests/store/inMemoryStore.steam.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../src/store/inMemoryStore";

describe("InMemoryStore steam linking", () => {
  it("stores and retrieves a link token", async () => {
    const store = new InMemoryStore();
    await store.createSteamLinkToken({ token: "abc", chatId: 1, userId: 100, expiresAt: 123 });
    expect(await store.getSteamLinkToken("abc")).toEqual({ token: "abc", chatId: 1, userId: 100, expiresAt: 123 });
  });

  it("returns undefined for an unknown token", async () => {
    const store = new InMemoryStore();
    expect(await store.getSteamLinkToken("nope")).toBeUndefined();
  });

  it("deletes a link token", async () => {
    const store = new InMemoryStore();
    await store.createSteamLinkToken({ token: "abc", chatId: 1, userId: 100, expiresAt: 123 });
    await store.deleteSteamLinkToken("abc");
    expect(await store.getSteamLinkToken("abc")).toBeUndefined();
  });

  it("stores, retrieves, and deletes a steam link", async () => {
    const store = new InMemoryStore();
    expect(await store.getSteamLink(1, 100)).toBeUndefined();

    await store.setSteamLink(1, 100, "76561198000000000");
    expect(await store.getSteamLink(1, 100)).toBe("76561198000000000");

    await store.deleteSteamLink(1, 100);
    expect(await store.getSteamLink(1, 100)).toBeUndefined();
  });

  it("scopes steam links per chat", async () => {
    const store = new InMemoryStore();
    await store.setSteamLink(1, 100, "111");
    await store.setSteamLink(2, 100, "222");
    expect(await store.getSteamLink(1, 100)).toBe("111");
    expect(await store.getSteamLink(2, 100)).toBe("222");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/store/inMemoryStore.steam.test.ts`
Expected: FAIL — `store.createSteamLinkToken is not a function` (method doesn't exist yet).

- [ ] **Step 3: Add the type and interface methods**

In `src/store/types.ts`, add after the existing `Role` interface:

```typescript
export interface SteamLinkToken {
  token: string;
  chatId: number;
  userId: number;
  expiresAt: number;
}
```

Add to the `Store` interface, after `getUserRoles`:

```typescript
  createSteamLinkToken(record: SteamLinkToken): Promise<void>;
  getSteamLinkToken(token: string): Promise<SteamLinkToken | undefined>;
  deleteSteamLinkToken(token: string): Promise<void>;

  setSteamLink(chatId: number, userId: number, steamId64: string): Promise<void>;
  getSteamLink(chatId: number, userId: number): Promise<string | undefined>;
  deleteSteamLink(chatId: number, userId: number): Promise<void>;
```

- [ ] **Step 4: Implement in InMemoryStore**

In `src/store/inMemoryStore.ts`, update the import and add fields/methods:

```typescript
import type { Member, Role, SteamLinkToken, Store } from "./types.js";
```

Add two private fields alongside the existing ones (`roleMembers`, `nextRoleId`):

```typescript
  private steamLinkTokens = new Map<string, SteamLinkToken>();
  private steamLinks = new Map<string, string>();
```

Add methods at the end of the class, before the closing brace:

```typescript
  async createSteamLinkToken(record: SteamLinkToken): Promise<void> {
    this.steamLinkTokens.set(record.token, record);
  }

  async getSteamLinkToken(token: string): Promise<SteamLinkToken | undefined> {
    return this.steamLinkTokens.get(token);
  }

  async deleteSteamLinkToken(token: string): Promise<void> {
    this.steamLinkTokens.delete(token);
  }

  async setSteamLink(chatId: number, userId: number, steamId64: string): Promise<void> {
    this.steamLinks.set(memberKey(chatId, userId), steamId64);
  }

  async getSteamLink(chatId: number, userId: number): Promise<string | undefined> {
    return this.steamLinks.get(memberKey(chatId, userId));
  }

  async deleteSteamLink(chatId: number, userId: number): Promise<void> {
    this.steamLinks.delete(memberKey(chatId, userId));
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/store/inMemoryStore.steam.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Implement in SupabaseStore (no dedicated test, matching existing convention)**

In `src/store/supabaseStore.ts`, update the import:

```typescript
import type { Member, Role, SteamLinkToken, Store } from "./types.js";
```

Add methods to the class, after `getUserRoles`:

```typescript
  async createSteamLinkToken(record: SteamLinkToken): Promise<void> {
    const { error } = await this.client.from("steam_link_tokens").insert({
      token: record.token,
      chat_id: record.chatId,
      user_id: record.userId,
      expires_at: new Date(record.expiresAt).toISOString(),
    });
    if (error) throw error;
  }

  async getSteamLinkToken(token: string): Promise<SteamLinkToken | undefined> {
    const { data, error } = await this.client
      .from("steam_link_tokens")
      .select("*")
      .eq("token", token)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToSteamLinkToken(data) : undefined;
  }

  async deleteSteamLinkToken(token: string): Promise<void> {
    const { error } = await this.client.from("steam_link_tokens").delete().eq("token", token);
    if (error) throw error;
  }

  async setSteamLink(chatId: number, userId: number, steamId64: string): Promise<void> {
    await this.client.from("groups").upsert({ chat_id: chatId });
    const { error } = await this.client.from("steam_links").upsert({
      chat_id: chatId,
      user_id: userId,
      steam_id64: steamId64,
    });
    if (error) throw error;
  }

  async getSteamLink(chatId: number, userId: number): Promise<string | undefined> {
    const { data, error } = await this.client
      .from("steam_links")
      .select("*")
      .eq("chat_id", chatId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data ? (data.steam_id64 as string) : undefined;
  }

  async deleteSteamLink(chatId: number, userId: number): Promise<void> {
    const { error } = await this.client
      .from("steam_links")
      .delete()
      .eq("chat_id", chatId)
      .eq("user_id", userId);
    if (error) throw error;
  }
```

Add the row-mapping helper at the bottom of the file, alongside `rowToMember`/`rowToRole`:

```typescript
function rowToSteamLinkToken(row: any): SteamLinkToken {
  return {
    token: row.token,
    chatId: row.chat_id,
    userId: row.user_id,
    expiresAt: new Date(row.expires_at).getTime(),
  };
}
```

- [ ] **Step 7: Add the tables to the schema**

Append to `supabase/schema.sql`:

```sql
create table steam_link_tokens (
  token       text primary key,
  chat_id     bigint not null,
  user_id     bigint not null,
  expires_at  timestamptz not null
);

create table steam_links (
  chat_id     bigint not null,
  user_id     bigint not null,
  steam_id64  text not null,
  linked_at   timestamptz not null default now(),
  primary key (chat_id, user_id)
);
```

- [ ] **Step 8: Typecheck and run the full suite**

Run: `npm run typecheck && npm test`
Expected: both PASS — confirms `SupabaseStore` satisfies the updated `Store` interface and nothing else broke.

- [ ] **Step 9: Commit**

```bash
git add src/store/types.ts src/store/inMemoryStore.ts src/store/supabaseStore.ts supabase/schema.sql tests/store/inMemoryStore.steam.test.ts
git commit -m "feat: add steam link data model to the store layer"
```

---

### Task 2: Steam OpenID verification logic

**Files:**
- Create: `src/steamAuth.ts`
- Test: `tests/steamAuth.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure module, only depends on the global `fetch` type).
- Produces, for Task 3:
  - `buildSteamLoginUrl(returnToUrl: string, realm: string): string`
  - `verifySteamOpenId(query: Record<string, string>, fetchImpl: typeof fetch): Promise<string | undefined>` — returns the verified SteamID64, or `undefined` if verification fails or the response is malformed.

- [ ] **Step 1: Write the failing tests**

Create `tests/steamAuth.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { buildSteamLoginUrl, verifySteamOpenId } from "../src/steamAuth";

describe("buildSteamLoginUrl", () => {
  it("builds a Steam OpenID checkid_setup URL", () => {
    const url = buildSteamLoginUrl("https://example.com/api/steam-link/callback?token=abc", "https://example.com");
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://steamcommunity.com/openid/login");
    expect(parsed.searchParams.get("openid.mode")).toBe("checkid_setup");
    expect(parsed.searchParams.get("openid.return_to")).toBe(
      "https://example.com/api/steam-link/callback?token=abc",
    );
    expect(parsed.searchParams.get("openid.realm")).toBe("https://example.com");
  });
});

describe("verifySteamOpenId", () => {
  const validQuery = {
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "id_res",
    "openid.claimed_id": "https://steamcommunity.com/openid/id/76561198000000000",
    "openid.identity": "https://steamcommunity.com/openid/id/76561198000000000",
  };

  it("returns the steamid64 when Steam confirms the response is valid", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      text: async () => "ns:http://specs.openid.net/auth/2.0\nis_valid:true\n",
    });

    const steamId = await verifySteamOpenId(validQuery, fetchImpl as unknown as typeof fetch);

    expect(steamId).toBe("76561198000000000");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://steamcommunity.com/openid/login",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns undefined when Steam rejects the response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      text: async () => "ns:http://specs.openid.net/auth/2.0\nis_valid:false\n",
    });

    const steamId = await verifySteamOpenId(validQuery, fetchImpl as unknown as typeof fetch);

    expect(steamId).toBeUndefined();
  });

  it("returns undefined without calling fetch when claimed_id is missing", async () => {
    const fetchImpl = vi.fn();

    const steamId = await verifySteamOpenId({ "openid.mode": "id_res" }, fetchImpl as unknown as typeof fetch);

    expect(steamId).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns undefined when claimed_id doesn't match Steam's format", async () => {
    const fetchImpl = vi.fn();

    const steamId = await verifySteamOpenId(
      { "openid.claimed_id": "https://example.com/not-steam" },
      fetchImpl as unknown as typeof fetch,
    );

    expect(steamId).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/steamAuth.test.ts`
Expected: FAIL — `Cannot find module '../src/steamAuth'`

- [ ] **Step 3: Implement `src/steamAuth.ts`**

```typescript
const STEAM_OPENID_ENDPOINT = "https://steamcommunity.com/openid/login";
const CLAIMED_ID_PATTERN = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/;

export function buildSteamLoginUrl(returnToUrl: string, realm: string): string {
  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": returnToUrl,
    "openid.realm": realm,
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
  });
  return `${STEAM_OPENID_ENDPOINT}?${params.toString()}`;
}

// Steam's OpenID 2.0 provider doesn't sign responses in a way we can verify
// locally; instead we must echo the whole response back to Steam with
// openid.mode=check_authentication and trust its is_valid:true/false verdict.
export async function verifySteamOpenId(
  query: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<string | undefined> {
  const claimedId = query["openid.claimed_id"];
  if (!claimedId) return undefined;
  const match = CLAIMED_ID_PATTERN.exec(claimedId);
  if (!match) return undefined;

  const verifyParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key.startsWith("openid.")) verifyParams.set(key, value);
  }
  verifyParams.set("openid.mode", "check_authentication");

  const response = await fetchImpl(STEAM_OPENID_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: verifyParams.toString(),
  });
  const text = await response.text();
  if (!/is_valid\s*:\s*true/.test(text)) return undefined;

  return match[1];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/steamAuth.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/steamAuth.ts tests/steamAuth.test.ts
git commit -m "feat: add Steam OpenID login URL builder and response verifier"
```

---

### Task 3: Link orchestration (token issuance + start/callback handling)

**Files:**
- Create: `src/steamLink.ts`
- Test: `tests/steamLink.test.ts`

**Interfaces:**
- Consumes: `Store` methods from Task 1 (`createSteamLinkToken`, `getSteamLinkToken`, `deleteSteamLinkToken`, `setSteamLink`, `getSteamLink`); `buildSteamLoginUrl`/`verifySteamOpenId` from Task 2.
- Produces, for Tasks 4 and 6:
  - `createLinkRequest(store: Store, chatId: number, userId: number): Promise<string>` — returns the new token.
  - `interface HttpResult { status: number; headers?: Record<string, string>; body: string }`
  - `handleStartRequest(store: Store, token: string | undefined, appUrl: string): Promise<HttpResult>`
  - `handleCallbackRequest(store: Store, query: Record<string, string>, fetchImpl?: typeof fetch): Promise<HttpResult>`

- [ ] **Step 1: Write the failing tests**

Create `tests/steamLink.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { InMemoryStore } from "../src/store/inMemoryStore";
import { createLinkRequest, handleStartRequest, handleCallbackRequest } from "../src/steamLink";

describe("createLinkRequest", () => {
  it("creates a token record tied to the chat and user, expiring in the future", async () => {
    const store = new InMemoryStore();
    const token = await createLinkRequest(store, 1, 100);
    const record = await store.getSteamLinkToken(token);
    expect(record).toMatchObject({ token, chatId: 1, userId: 100 });
    expect(record!.expiresAt).toBeGreaterThan(Date.now());
  });
});

describe("handleStartRequest", () => {
  it("redirects to Steam when the token is valid", async () => {
    const store = new InMemoryStore();
    const token = await createLinkRequest(store, 1, 100);

    const result = await handleStartRequest(store, token, "https://example.com");

    expect(result.status).toBe(302);
    expect(result.headers?.Location).toContain("https://steamcommunity.com/openid/login");
  });

  it("rejects a missing token", async () => {
    const store = new InMemoryStore();
    const result = await handleStartRequest(store, undefined, "https://example.com");
    expect(result.status).toBe(400);
  });

  it("rejects an expired token", async () => {
    const store = new InMemoryStore();
    const token = "expired-token";
    await store.createSteamLinkToken({ token, chatId: 1, userId: 100, expiresAt: Date.now() - 1000 });

    const result = await handleStartRequest(store, token, "https://example.com");

    expect(result.status).toBe(400);
  });
});

describe("handleCallbackRequest", () => {
  it("links the Steam account and consumes the token on success", async () => {
    const store = new InMemoryStore();
    const token = await createLinkRequest(store, 1, 100);
    const fetchImpl = vi.fn().mockResolvedValue({ text: async () => "is_valid:true\n" });
    const query = { token, "openid.claimed_id": "https://steamcommunity.com/openid/id/76561198000000000" };

    const result = await handleCallbackRequest(store, query, fetchImpl as unknown as typeof fetch);

    expect(result.status).toBe(200);
    expect(await store.getSteamLink(1, 100)).toBe("76561198000000000");
    expect(await store.getSteamLinkToken(token)).toBeUndefined();
  });

  it("does not link when Steam rejects the response, but still consumes the token", async () => {
    const store = new InMemoryStore();
    const token = await createLinkRequest(store, 1, 100);
    const fetchImpl = vi.fn().mockResolvedValue({ text: async () => "is_valid:false\n" });
    const query = { token, "openid.claimed_id": "https://steamcommunity.com/openid/id/76561198000000000" };

    const result = await handleCallbackRequest(store, query, fetchImpl as unknown as typeof fetch);

    expect(result.status).toBe(400);
    expect(await store.getSteamLink(1, 100)).toBeUndefined();
    expect(await store.getSteamLinkToken(token)).toBeUndefined();
  });

  it("rejects when the token is missing, unknown, or expired, without calling Steam", async () => {
    const store = new InMemoryStore();
    const fetchImpl = vi.fn();

    const result = await handleCallbackRequest(store, { token: "nope" }, fetchImpl as unknown as typeof fetch);

    expect(result.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/steamLink.test.ts`
Expected: FAIL — `Cannot find module '../src/steamLink'`

- [ ] **Step 3: Implement `src/steamLink.ts`**

```typescript
import { randomBytes } from "node:crypto";
import type { Store } from "./store/types.js";
import { buildSteamLoginUrl, verifySteamOpenId } from "./steamAuth.js";

const TOKEN_TTL_MS = 10 * 60 * 1000;

export const EXPIRED_LINK_MESSAGE = "This link has expired. Go back to Telegram and run /linksteam again.";
const VERIFICATION_FAILED_MESSAGE =
  "Steam couldn't verify that login. Go back to Telegram and run /linksteam again.";
const LINKED_MESSAGE = "Linked! You can close this tab and return to Telegram.";

export interface HttpResult {
  status: number;
  headers?: Record<string, string>;
  body: string;
}

export async function createLinkRequest(store: Store, chatId: number, userId: number): Promise<string> {
  const token = randomBytes(16).toString("hex");
  await store.createSteamLinkToken({ token, chatId, userId, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

export async function handleStartRequest(
  store: Store,
  token: string | undefined,
  appUrl: string,
): Promise<HttpResult> {
  if (!token) return { status: 400, body: EXPIRED_LINK_MESSAGE };
  const record = await store.getSteamLinkToken(token);
  if (!record || record.expiresAt < Date.now()) return { status: 400, body: EXPIRED_LINK_MESSAGE };

  const returnUrl = `${appUrl}/api/steam-link/callback?token=${token}`;
  const loginUrl = buildSteamLoginUrl(returnUrl, appUrl);
  return { status: 302, headers: { Location: loginUrl }, body: "" };
}

export async function handleCallbackRequest(
  store: Store,
  query: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<HttpResult> {
  const token = query.token;
  if (!token) return { status: 400, body: EXPIRED_LINK_MESSAGE };
  const record = await store.getSteamLinkToken(token);
  if (!record || record.expiresAt < Date.now()) return { status: 400, body: EXPIRED_LINK_MESSAGE };

  const steamId64 = await verifySteamOpenId(query, fetchImpl);
  // The token is single-use regardless of outcome, so a rejected or replayed
  // callback can't be retried against the same token.
  await store.deleteSteamLinkToken(token);
  if (!steamId64) return { status: 400, body: VERIFICATION_FAILED_MESSAGE };

  await store.setSteamLink(record.chatId, record.userId, steamId64);
  return { status: 200, body: LINKED_MESSAGE };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/steamLink.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/steamLink.ts tests/steamLink.test.ts
git commit -m "feat: add Steam link token issuance and OpenID start/callback handling"
```

---

### Task 4: Chat commands

**Files:**
- Create: `src/commands/steamCommands.ts`
- Test: `tests/commands/steamCommands.test.ts`

**Interfaces:**
- Consumes: `createLinkRequest` from Task 3; `Store.getSteamLink`/`deleteSteamLink` from Task 1.
- Produces, for Task 5:
  - `handleLinkSteam(store: Store, chatId: number, userId: number, appUrl: string): Promise<string>`
  - `handleMySteam(store: Store, chatId: number, userId: number): Promise<string>`
  - `handleUnlinkSteam(store: Store, chatId: number, userId: number): Promise<string>`

- [ ] **Step 1: Write the failing tests**

Create `tests/commands/steamCommands.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../src/store/inMemoryStore";
import { handleLinkSteam, handleMySteam, handleUnlinkSteam } from "../../src/commands/steamCommands";

describe("handleLinkSteam", () => {
  it("replies with a one-time link built from the app URL", async () => {
    const store = new InMemoryStore();
    const reply = await handleLinkSteam(store, 1, 100, "https://example.com");
    expect(reply).toContain("https://example.com/api/steam-link/start?token=");
  });
});

describe("handleMySteam", () => {
  it("reports when nothing is linked", async () => {
    const store = new InMemoryStore();
    const reply = await handleMySteam(store, 1, 100);
    expect(reply).toBe("You haven't linked a Steam account yet — run /linksteam.");
  });

  it("reports the linked profile", async () => {
    const store = new InMemoryStore();
    await store.setSteamLink(1, 100, "76561198000000000");
    const reply = await handleMySteam(store, 1, 100);
    expect(reply).toBe("Your linked Steam account: https://steamcommunity.com/profiles/76561198000000000");
  });
});

describe("handleUnlinkSteam", () => {
  it("reports when there's nothing to unlink", async () => {
    const store = new InMemoryStore();
    const reply = await handleUnlinkSteam(store, 1, 100);
    expect(reply).toBe("You don't have a linked Steam account.");
  });

  it("removes an existing link", async () => {
    const store = new InMemoryStore();
    await store.setSteamLink(1, 100, "76561198000000000");
    const reply = await handleUnlinkSteam(store, 1, 100);
    expect(reply).toBe("Your Steam account has been unlinked.");
    expect(await store.getSteamLink(1, 100)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/commands/steamCommands.test.ts`
Expected: FAIL — `Cannot find module '../../src/commands/steamCommands'`

- [ ] **Step 3: Implement `src/commands/steamCommands.ts`**

```typescript
import type { Store } from "../store/types.js";
import { createLinkRequest } from "../steamLink.js";

export async function handleLinkSteam(
  store: Store,
  chatId: number,
  userId: number,
  appUrl: string,
): Promise<string> {
  const token = await createLinkRequest(store, chatId, userId);
  return `Click to link your Steam account (expires in 10 minutes):\n${appUrl}/api/steam-link/start?token=${token}`;
}

export async function handleMySteam(store: Store, chatId: number, userId: number): Promise<string> {
  const steamId64 = await store.getSteamLink(chatId, userId);
  if (!steamId64) return "You haven't linked a Steam account yet — run /linksteam.";
  return `Your linked Steam account: https://steamcommunity.com/profiles/${steamId64}`;
}

export async function handleUnlinkSteam(store: Store, chatId: number, userId: number): Promise<string> {
  const existing = await store.getSteamLink(chatId, userId);
  if (!existing) return "You don't have a linked Steam account.";
  await store.deleteSteamLink(chatId, userId);
  return "Your Steam account has been unlinked.";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/commands/steamCommands.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/commands/steamCommands.ts tests/commands/steamCommands.test.ts
git commit -m "feat: add /linksteam, /mysteam, /unlinksteam command handlers"
```

---

### Task 5: Wire commands into the bot

**Files:**
- Modify: `src/bot.ts`
- Modify: `api/webhook.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `handleLinkSteam`, `handleMySteam`, `handleUnlinkSteam` from Task 4.
- Produces: `createBot(token: string, store: Store, publicUrl: string): Bot` (signature change — third parameter added). No further tasks in this plan consume this directly, but it's the shape any future sub-project's bot wiring must match.

There is no dedicated bot.ts test file in this repo (existing commands are only tested at the handler level, as in Task 4); this task is verified via typecheck and the full suite instead.

- [ ] **Step 1: Add the commands to `src/bot.ts`**

Add the import near the other command imports at the top:

```typescript
import { handleLinkSteam, handleMySteam, handleUnlinkSteam } from "./commands/steamCommands.js";
```

Change the `createBot` signature:

```typescript
export function createBot(token: string, store: Store, publicUrl: string): Bot {
```

Add three new commands, placed after the `navi` command and before the `help`/`commands` command:

```typescript
  bot.command("linksteam", async (ctx) => {
    if (!isGroupChat(ctx.chat.type)) return ctx.reply("This command only works in a group.");
    if (!ctx.from) return;
    return ctx.reply(await handleLinkSteam(store, ctx.chat.id, ctx.from.id, publicUrl));
  });

  bot.command("mysteam", async (ctx) => {
    if (!isGroupChat(ctx.chat.type)) return ctx.reply("This command only works in a group.");
    if (!ctx.from) return;
    return ctx.reply(await handleMySteam(store, ctx.chat.id, ctx.from.id));
  });

  bot.command("unlinksteam", async (ctx) => {
    if (!isGroupChat(ctx.chat.type)) return ctx.reply("This command only works in a group.");
    if (!ctx.from) return;
    return ctx.reply(await handleUnlinkSteam(store, ctx.chat.id, ctx.from.id));
  });
```

Add three lines to `HELP_TEXT`, after the `/roast` line and before `/help`:

```
/linksteam - link your Steam account (opens a browser to verify via Steam login)
/mysteam - show your linked Steam account
/unlinksteam - remove your linked Steam account
```

- [ ] **Step 2: Update `api/webhook.ts` to pass the new argument**

```typescript
import { webhookCallback } from "grammy";
import type { IncomingMessage, ServerResponse } from "http";
import { createBot } from "../src/bot.js";
import { SupabaseStore } from "../src/store/supabaseStore.js";

const token = process.env.BOT_TOKEN;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const publicUrl = process.env.PUBLIC_URL;

if (!token || !supabaseUrl || !supabaseKey || !publicUrl) {
  throw new Error("Missing BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or PUBLIC_URL environment variable");
}

const store = new SupabaseStore(supabaseUrl, supabaseKey);
const bot = createBot(token, store, publicUrl);
const handleUpdate = webhookCallback(bot, "http");

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    await handleUpdate(req, res);
  } catch (err) {
    console.error("Error handling Telegram update:", err);
    if (!res.headersSent) {
      res.statusCode = 200;
      res.end("ok");
    }
  }
}
```

- [ ] **Step 3: Add `PUBLIC_URL` to `.env.example`**

```
BOT_TOKEN=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
WEBHOOK_URL=
PUBLIC_URL=
```

- [ ] **Step 4: Typecheck and run the full suite**

Run: `npm run typecheck && npm test`
Expected: both PASS

- [ ] **Step 5: Commit**

```bash
git add src/bot.ts api/webhook.ts .env.example
git commit -m "feat: wire /linksteam, /mysteam, /unlinksteam into the bot"
```

---

### Task 6: Vercel API routes for the OpenID redirect/callback

**Files:**
- Create: `api/steam-link/start.ts`
- Create: `api/steam-link/callback.ts`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: `handleStartRequest`, `handleCallbackRequest`, `HttpResult` from Task 3; `SupabaseStore` from Task 1.
- Produces: nothing further consumed within this plan — this is the last task, and the end-to-end flow is manually verifiable after it (see Step 3).

No dedicated test file: like `api/webhook.ts`, these are thin `IncomingMessage`/`ServerResponse` wrappers with all logic already covered by Task 3's tests. Verified via typecheck and a manual local check.

- [ ] **Step 1: Implement `api/steam-link/start.ts`**

```typescript
import type { IncomingMessage, ServerResponse } from "http";
import { SupabaseStore } from "../../src/store/supabaseStore.js";
import { handleStartRequest } from "../../src/steamLink.js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const publicUrl = process.env.PUBLIC_URL;

if (!supabaseUrl || !supabaseKey || !publicUrl) {
  throw new Error("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or PUBLIC_URL environment variable");
}

const store = new SupabaseStore(supabaseUrl, supabaseKey);

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "", "http://localhost");
  const token = url.searchParams.get("token") ?? undefined;
  const result = await handleStartRequest(store, token, publicUrl);

  res.statusCode = result.status;
  for (const [key, value] of Object.entries(result.headers ?? {})) {
    res.setHeader(key, value);
  }
  res.setHeader("Content-Type", "text/plain");
  res.end(result.body);
}
```

- [ ] **Step 2: Implement `api/steam-link/callback.ts`**

```typescript
import type { IncomingMessage, ServerResponse } from "http";
import { SupabaseStore } from "../../src/store/supabaseStore.js";
import { handleCallbackRequest } from "../../src/steamLink.js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable");
}

const store = new SupabaseStore(supabaseUrl, supabaseKey);

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "", "http://localhost");
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });

  const result = await handleCallbackRequest(store, query);

  res.statusCode = result.status;
  res.setHeader("Content-Type", "text/plain");
  res.end(result.body);
}
```

- [ ] **Step 3: Add the new routes to `vercel.json`**

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
    }
  }
}
```

- [ ] **Step 4: Typecheck and run the full suite**

Run: `npm run typecheck && npm test`
Expected: both PASS

- [ ] **Step 5: Commit**

```bash
git add api/steam-link/start.ts api/steam-link/callback.ts vercel.json
git commit -m "feat: add Steam OpenID start/callback API routes"
```

- [ ] **Step 6: Manual end-to-end verification after deploying**

After deploying with `PUBLIC_URL` set to the deployed Vercel URL:
1. In a Telegram group with the bot, run `/linksteam`.
2. Open the returned link in a browser; confirm it redirects to a real Steam login page.
3. Log in and approve; confirm the browser lands on the "Linked!" confirmation page.
4. Back in Telegram, run `/mysteam`; confirm it shows the correct `steamcommunity.com/profiles/<id>` link for the Steam account just used.
5. Run `/unlinksteam`, then `/mysteam` again; confirm it reports no linked account.
