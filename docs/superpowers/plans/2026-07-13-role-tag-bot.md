# Telegram Role-Tag Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Telegram bot, deployed as a Vercel serverless function with Supabase for persistence, that lets group admins define custom roles and lets any member tag `@all` or `@RoleName` to get clickable mention notifications for that group.

**Architecture:** A single Vercel Node.js serverless function (`api/webhook.ts`) receives Telegram updates via webhook and dispatches them through a grammY `Bot` instance. All persistence goes through a `Store` interface (`src/store/types.ts`) so business logic (tag resolution, command handlers) can be fully unit-tested against an `InMemoryStore`, while `SupabaseStore` is the production implementation backed by Postgres.

**Tech Stack:** TypeScript, grammY (Telegram bot framework), Supabase (`@supabase/supabase-js`), Vitest (tests), tsx (running TS scripts), deployed on Vercel.

## Global Constraints

- Hosting: Vercel (serverless function) + Supabase (Postgres), both free tier — no other paid services.
- Bot library: grammY.
- Target scale: groups of roughly ≤10 members — no message-batching/chunking logic for Telegram's 4096-character limit (explicitly out of scope per spec).
- Role management commands (`/createrole`, `/deleterole`, `/assign`, `/unassign`) are admin-only, checked live via `getChatMember` on every call — never cached.
- Tagging (`@all`, `@RoleName`) is open to any group member.
- Commands are rejected (with a short message) when used in a DM to the bot rather than a group.
- Unknown role tags (e.g. a typo) are silently ignored — no reply.
- Webhook handler must always return HTTP 200 to Telegram, even on internal errors, logging the error server-side instead.

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `vercel.json`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `supabase/schema.sql`

**Interfaces:**
- Produces: npm scripts `test`, `typecheck`, `set-webhook` that later tasks and CI rely on.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "brotag",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "set-webhook": "tsx scripts/set-webhook.ts"
  },
  "dependencies": {
    "grammy": "^1.21.1",
    "@supabase/supabase-js": "^2.45.4"
  },
  "devDependencies": {
    "@types/node": "^20.14.15",
    "tsx": "^4.16.2",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src", "api", "scripts", "tests"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
});
```

- [ ] **Step 4: Create `vercel.json`**

```json
{
  "functions": {
    "api/webhook.ts": {
      "maxDuration": 10
    }
  }
}
```

- [ ] **Step 5: Create `.env.example`**

```
BOT_TOKEN=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
WEBHOOK_URL=
```

- [ ] **Step 6: Create `.gitignore`**

```
node_modules
dist
.env
.env.local
```

- [ ] **Step 7: Create `supabase/schema.sql`**

```sql
create table groups (
  chat_id bigint primary key,
  title text
);

create table members (
  chat_id bigint references groups(chat_id) on delete cascade,
  user_id bigint not null,
  username text,
  first_name text not null,
  primary key (chat_id, user_id)
);

create table roles (
  id bigserial primary key,
  chat_id bigint references groups(chat_id) on delete cascade,
  name text not null,
  unique (chat_id, name)
);

create table role_members (
  role_id bigint references roles(id) on delete cascade,
  user_id bigint not null,
  primary key (role_id, user_id)
);
```

- [ ] **Step 8: Install dependencies and verify the toolchain runs**

Run: `npm install`
Expected: dependencies install with no errors.

Run: `npm run typecheck`
Expected: passes (no `.ts` files exist yet, so this just confirms `tsc` runs — if it errors with "no inputs found", create an empty `src/index.ts` with `export {};` first).

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts vercel.json .env.example .gitignore supabase/schema.sql
git commit -m "chore: scaffold project tooling and Supabase schema"
```

---

### Task 2: Store interface and in-memory member tracking

**Files:**
- Create: `src/store/types.ts`
- Create: `src/store/inMemoryStore.ts`
- Test: `tests/store/inMemoryStore.members.test.ts`

**Interfaces:**
- Produces: `Member { chatId: number; userId: number; username?: string; firstName: string }`, `Role { id: string; chatId: number; name: string }`, `Store` interface, `InMemoryStore` class implementing `Store.upsertMember`, `Store.getMembers`, `Store.getMember`.

- [ ] **Step 1: Write the failing test**

Create `tests/store/inMemoryStore.members.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../src/store/inMemoryStore";

describe("InMemoryStore member tracking", () => {
  it("upserts a member and retrieves it", async () => {
    const store = new InMemoryStore();
    await store.upsertMember({ chatId: 1, userId: 100, firstName: "Ada" });

    const member = await store.getMember(1, 100);
    expect(member).toEqual({ chatId: 1, userId: 100, firstName: "Ada" });
  });

  it("overwrites fields on repeated upsert of the same user", async () => {
    const store = new InMemoryStore();
    await store.upsertMember({ chatId: 1, userId: 100, firstName: "Ada" });
    await store.upsertMember({ chatId: 1, userId: 100, firstName: "Ada L.", username: "ada" });

    const member = await store.getMember(1, 100);
    expect(member).toEqual({ chatId: 1, userId: 100, firstName: "Ada L.", username: "ada" });
  });

  it("scopes members by chatId", async () => {
    const store = new InMemoryStore();
    await store.upsertMember({ chatId: 1, userId: 100, firstName: "Ada" });
    await store.upsertMember({ chatId: 2, userId: 100, firstName: "Ada-in-other-chat" });

    const chat1Members = await store.getMembers(1);
    expect(chat1Members).toEqual([{ chatId: 1, userId: 100, firstName: "Ada" }]);
  });

  it("returns undefined for a user that has never posted", async () => {
    const store = new InMemoryStore();
    const member = await store.getMember(1, 999);
    expect(member).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/store/inMemoryStore.members.test.ts`
Expected: FAIL — `Cannot find module '../../src/store/inMemoryStore'`

- [ ] **Step 3: Write `src/store/types.ts`**

```ts
export interface Member {
  chatId: number;
  userId: number;
  username?: string;
  firstName: string;
}

export interface Role {
  id: string;
  chatId: number;
  name: string;
}

export interface Store {
  upsertMember(member: Member): Promise<void>;
  getMembers(chatId: number): Promise<Member[]>;
  getMember(chatId: number, userId: number): Promise<Member | undefined>;

  createRole(chatId: number, name: string): Promise<Role>;
  deleteRole(chatId: number, name: string): Promise<void>;
  findRole(chatId: number, name: string): Promise<Role | undefined>;
  listRoles(chatId: number): Promise<Role[]>;

  assignUserToRole(roleId: string, userId: number): Promise<void>;
  unassignUserFromRole(roleId: string, userId: number): Promise<void>;
  getRoleMembers(roleId: string): Promise<Member[]>;
  getUserRoles(chatId: number, userId: number): Promise<Role[]>;
}
```

- [ ] **Step 4: Write `src/store/inMemoryStore.ts`** (member methods only for now; role methods stubbed to throw so the class type-checks against `Store`)

```ts
import type { Member, Role, Store } from "./types";

function memberKey(chatId: number, userId: number): string {
  return `${chatId}:${userId}`;
}

export class InMemoryStore implements Store {
  private members = new Map<string, Member>();
  private roles = new Map<string, Role>();
  private roleMembers = new Map<string, Set<number>>();
  private nextRoleId = 1;

  async upsertMember(member: Member): Promise<void> {
    this.members.set(memberKey(member.chatId, member.userId), member);
  }

  async getMembers(chatId: number): Promise<Member[]> {
    return [...this.members.values()].filter((m) => m.chatId === chatId);
  }

  async getMember(chatId: number, userId: number): Promise<Member | undefined> {
    return this.members.get(memberKey(chatId, userId));
  }

  async createRole(chatId: number, name: string): Promise<Role> {
    const role: Role = { id: String(this.nextRoleId++), chatId, name };
    this.roles.set(role.id, role);
    this.roleMembers.set(role.id, new Set());
    return role;
  }

  async deleteRole(chatId: number, name: string): Promise<void> {
    const role = await this.findRole(chatId, name);
    if (!role) return;
    this.roles.delete(role.id);
    this.roleMembers.delete(role.id);
  }

  async findRole(chatId: number, name: string): Promise<Role | undefined> {
    return [...this.roles.values()].find((r) => r.chatId === chatId && r.name === name);
  }

  async listRoles(chatId: number): Promise<Role[]> {
    return [...this.roles.values()].filter((r) => r.chatId === chatId);
  }

  async assignUserToRole(roleId: string, userId: number): Promise<void> {
    this.roleMembers.get(roleId)?.add(userId);
  }

  async unassignUserFromRole(roleId: string, userId: number): Promise<void> {
    this.roleMembers.get(roleId)?.delete(userId);
  }

  async getRoleMembers(roleId: string): Promise<Member[]> {
    const role = this.roles.get(roleId);
    if (!role) return [];
    const userIds = this.roleMembers.get(roleId) ?? new Set();
    const members = await this.getMembers(role.chatId);
    return members.filter((m) => userIds.has(m.userId));
  }

  async getUserRoles(chatId: number, userId: number): Promise<Role[]> {
    const roles = await this.listRoles(chatId);
    return roles.filter((r) => this.roleMembers.get(r.id)?.has(userId));
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/store/inMemoryStore.members.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/store/types.ts src/store/inMemoryStore.ts tests/store/inMemoryStore.members.test.ts
git commit -m "feat: add Store interface and in-memory member tracking"
```

---

### Task 3: Role CRUD in the store

**Files:**
- Modify: `src/store/inMemoryStore.ts` (already implements this from Task 2 — this task adds test coverage and fixes any gaps found)
- Test: `tests/store/inMemoryStore.roles.test.ts`

**Interfaces:**
- Consumes: `InMemoryStore` from Task 2.
- Produces: verified behavior for `createRole`, `deleteRole`, `findRole`, `listRoles`.

- [ ] **Step 1: Write the failing test**

Create `tests/store/inMemoryStore.roles.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../src/store/inMemoryStore";

describe("InMemoryStore role CRUD", () => {
  it("creates a role and finds it by name", async () => {
    const store = new InMemoryStore();
    const created = await store.createRole(1, "Designers");

    const found = await store.findRole(1, "Designers");
    expect(found).toEqual(created);
  });

  it("lists all roles for a chat", async () => {
    const store = new InMemoryStore();
    await store.createRole(1, "Designers");
    await store.createRole(1, "Moderators");
    await store.createRole(2, "OtherChatRole");

    const roles = await store.listRoles(1);
    expect(roles.map((r) => r.name).sort()).toEqual(["Designers", "Moderators"]);
  });

  it("deletes a role by name", async () => {
    const store = new InMemoryStore();
    await store.createRole(1, "Designers");
    await store.deleteRole(1, "Designers");

    const found = await store.findRole(1, "Designers");
    expect(found).toBeUndefined();
  });

  it("deleting a nonexistent role is a no-op, not an error", async () => {
    const store = new InMemoryStore();
    await expect(store.deleteRole(1, "Nope")).resolves.toBeUndefined();
  });

  it("scopes role names by chatId (same name allowed in different chats)", async () => {
    const store = new InMemoryStore();
    const roleA = await store.createRole(1, "Designers");
    const roleB = await store.createRole(2, "Designers");
    expect(roleA.id).not.toEqual(roleB.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `npm test -- tests/store/inMemoryStore.roles.test.ts`
Expected: Likely PASS already, since Task 2's `InMemoryStore` implements these methods. If any test fails, proceed to Step 3 to fix; if all pass, skip to Step 4.

- [ ] **Step 3: Fix any failing behavior in `src/store/inMemoryStore.ts`**

(Only if Step 2 showed a failure.) The implementation from Task 2 already satisfies these semantics — no code change expected. If a failure appears, adjust the relevant method in `src/store/inMemoryStore.ts` to match the test's expected behavior before proceeding.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/store/inMemoryStore.roles.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add tests/store/inMemoryStore.roles.test.ts
git commit -m "test: cover role CRUD behavior in InMemoryStore"
```

---

### Task 4: Role membership in the store

**Files:**
- Modify: `src/store/inMemoryStore.ts` (already implements this from Task 2 — this task adds test coverage)
- Test: `tests/store/inMemoryStore.membership.test.ts`

**Interfaces:**
- Consumes: `InMemoryStore` from Task 2.
- Produces: verified behavior for `assignUserToRole`, `unassignUserFromRole`, `getRoleMembers`, `getUserRoles`.

- [ ] **Step 1: Write the failing test**

Create `tests/store/inMemoryStore.membership.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../src/store/inMemoryStore";

describe("InMemoryStore role membership", () => {
  it("assigns a member to a role and lists them", async () => {
    const store = new InMemoryStore();
    await store.upsertMember({ chatId: 1, userId: 100, firstName: "Ada" });
    const role = await store.createRole(1, "Designers");

    await store.assignUserToRole(role.id, 100);

    const members = await store.getRoleMembers(role.id);
    expect(members).toEqual([{ chatId: 1, userId: 100, firstName: "Ada" }]);
  });

  it("unassigns a member from a role", async () => {
    const store = new InMemoryStore();
    await store.upsertMember({ chatId: 1, userId: 100, firstName: "Ada" });
    const role = await store.createRole(1, "Designers");
    await store.assignUserToRole(role.id, 100);

    await store.unassignUserFromRole(role.id, 100);

    const members = await store.getRoleMembers(role.id);
    expect(members).toEqual([]);
  });

  it("returns all roles a user belongs to in a chat", async () => {
    const store = new InMemoryStore();
    await store.upsertMember({ chatId: 1, userId: 100, firstName: "Ada" });
    const designers = await store.createRole(1, "Designers");
    const mods = await store.createRole(1, "Moderators");
    await store.assignUserToRole(designers.id, 100);
    await store.assignUserToRole(mods.id, 100);

    const roles = await store.getUserRoles(1, 100);
    expect(roles.map((r) => r.name).sort()).toEqual(["Designers", "Moderators"]);
  });

  it("getRoleMembers returns an empty array for an unknown roleId", async () => {
    const store = new InMemoryStore();
    const members = await store.getRoleMembers("does-not-exist");
    expect(members).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `npm test -- tests/store/inMemoryStore.membership.test.ts`
Expected: Likely PASS already from Task 2's implementation. If a failure appears, fix `src/store/inMemoryStore.ts` accordingly.

- [ ] **Step 3: Run test to verify it passes**

Run: `npm test -- tests/store/inMemoryStore.membership.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 4: Commit**

```bash
git add tests/store/inMemoryStore.membership.test.ts
git commit -m "test: cover role membership behavior in InMemoryStore"
```

---

### Task 5: Tag-token parsing

**Files:**
- Create: `src/tagging/parseTags.ts`
- Test: `tests/tagging/parseTags.test.ts`

**Interfaces:**
- Produces: `parseTags(text: string): string[]` — returns the raw tag names found (`"all"` for `@all`, `"Designers"` for `@Designers`), deduplicated, in first-seen order.

- [ ] **Step 1: Write the failing test**

Create `tests/tagging/parseTags.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseTags } from "../../src/tagging/parseTags";

describe("parseTags", () => {
  it("finds a single @all tag", () => {
    expect(parseTags("hey @all check this out")).toEqual(["all"]);
  });

  it("finds a single role tag", () => {
    expect(parseTags("@Designers can you review?")).toEqual(["Designers"]);
  });

  it("finds multiple distinct tags in one message", () => {
    expect(parseTags("@all and also @Designers please")).toEqual(["all", "Designers"]);
  });

  it("deduplicates repeated tags, keeping first-seen order", () => {
    expect(parseTags("@Designers @Moderators @Designers")).toEqual(["Designers", "Moderators"]);
  });

  it("returns an empty array when there are no tags", () => {
    expect(parseTags("just a normal message")).toEqual([]);
  });

  it("ignores an email-like string that merely contains an @", () => {
    expect(parseTags("contact me at ada@example.com")).toEqual([]);
  });

  it("is case-sensitive for role names but not for the all keyword casing itself", () => {
    expect(parseTags("@ALL")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/tagging/parseTags.test.ts`
Expected: FAIL — `Cannot find module '../../src/tagging/parseTags'`

- [ ] **Step 3: Write `src/tagging/parseTags.ts`**

```ts
const TAG_PATTERN = /(?<=^|\s)@([A-Za-z][A-Za-z0-9_]*)(?=\s|$)/g;

export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const match of text.matchAll(TAG_PATTERN)) {
    const tag = match[1];
    if (!seen.has(tag)) {
      seen.add(tag);
      result.push(tag);
    }
  }

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/tagging/parseTags.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tagging/parseTags.ts tests/tagging/parseTags.test.ts
git commit -m "feat: add tag-token parsing for @all and @Role mentions"
```

---

### Task 6: Tag resolution and mention formatting

**Files:**
- Create: `src/tagging/resolveTags.ts`
- Create: `src/tagging/formatMentions.ts`
- Test: `tests/tagging/resolveTags.test.ts`
- Test: `tests/tagging/formatMentions.test.ts`

**Interfaces:**
- Consumes: `Store`, `Member`, `Role` from `src/store/types.ts`; `parseTags` from Task 5.
- Produces: `resolveTags(text: string, store: Store, chatId: number): Promise<Member[]>` (deduplicated, merged across all tags in the message); `formatMentions(members: Member[]): string`.

- [ ] **Step 1: Write the failing test for `formatMentions`**

Create `tests/tagging/formatMentions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatMentions } from "../../src/tagging/formatMentions";

describe("formatMentions", () => {
  it("formats a single member as a text-mention link", () => {
    const text = formatMentions([{ chatId: 1, userId: 100, firstName: "Ada" }]);
    expect(text).toBe("[Ada](tg://user?id=100)");
  });

  it("formats multiple members, one per line", () => {
    const text = formatMentions([
      { chatId: 1, userId: 100, firstName: "Ada" },
      { chatId: 1, userId: 200, firstName: "Grace" },
    ]);
    expect(text).toBe("[Ada](tg://user?id=100)\n[Grace](tg://user?id=200)");
  });

  it("returns an empty string for no members", () => {
    expect(formatMentions([])).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/tagging/formatMentions.test.ts`
Expected: FAIL — `Cannot find module '../../src/tagging/formatMentions'`

- [ ] **Step 3: Write `src/tagging/formatMentions.ts`**

```ts
import type { Member } from "../store/types";

export function formatMentions(members: Member[]): string {
  return members.map((m) => `[${m.firstName}](tg://user?id=${m.userId})`).join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/tagging/formatMentions.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the failing test for `resolveTags`**

Create `tests/tagging/resolveTags.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../src/store/inMemoryStore";
import { resolveTags } from "../../src/tagging/resolveTags";

describe("resolveTags", () => {
  it("resolves @all to every member of the chat", async () => {
    const store = new InMemoryStore();
    await store.upsertMember({ chatId: 1, userId: 100, firstName: "Ada" });
    await store.upsertMember({ chatId: 1, userId: 200, firstName: "Grace" });

    const members = await resolveTags("@all", store, 1);
    expect(members.map((m) => m.userId).sort()).toEqual([100, 200]);
  });

  it("resolves @RoleName to that role's members", async () => {
    const store = new InMemoryStore();
    await store.upsertMember({ chatId: 1, userId: 100, firstName: "Ada" });
    await store.upsertMember({ chatId: 1, userId: 200, firstName: "Grace" });
    const role = await store.createRole(1, "Designers");
    await store.assignUserToRole(role.id, 100);

    const members = await resolveTags("@Designers", store, 1);
    expect(members.map((m) => m.userId)).toEqual([100]);
  });

  it("merges and deduplicates members across multiple tags", async () => {
    const store = new InMemoryStore();
    await store.upsertMember({ chatId: 1, userId: 100, firstName: "Ada" });
    await store.upsertMember({ chatId: 1, userId: 200, firstName: "Grace" });
    const designers = await store.createRole(1, "Designers");
    const mods = await store.createRole(1, "Moderators");
    await store.assignUserToRole(designers.id, 100);
    await store.assignUserToRole(mods.id, 100);
    await store.assignUserToRole(mods.id, 200);

    const members = await resolveTags("@Designers @Moderators", store, 1);
    expect(members.map((m) => m.userId).sort()).toEqual([100, 200]);
  });

  it("silently ignores an unknown role tag", async () => {
    const store = new InMemoryStore();
    await store.upsertMember({ chatId: 1, userId: 100, firstName: "Ada" });

    const members = await resolveTags("@Nonexistent", store, 1);
    expect(members).toEqual([]);
  });

  it("returns an empty array when the message has no tags", async () => {
    const store = new InMemoryStore();
    const members = await resolveTags("no tags here", store, 1);
    expect(members).toEqual([]);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- tests/tagging/resolveTags.test.ts`
Expected: FAIL — `Cannot find module '../../src/tagging/resolveTags'`

- [ ] **Step 7: Write `src/tagging/resolveTags.ts`**

```ts
import type { Member, Store } from "../store/types";
import { parseTags } from "./parseTags";

export async function resolveTags(text: string, store: Store, chatId: number): Promise<Member[]> {
  const tags = parseTags(text);
  const resolved = new Map<number, Member>();

  for (const tag of tags) {
    const members = tag === "all" ? await store.getMembers(chatId) : await resolveRole(tag, store, chatId);
    for (const member of members) {
      resolved.set(member.userId, member);
    }
  }

  return [...resolved.values()];
}

async function resolveRole(name: string, store: Store, chatId: number): Promise<Member[]> {
  const role = await store.findRole(chatId, name);
  if (!role) return [];
  return store.getRoleMembers(role.id);
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- tests/tagging/resolveTags.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 9: Commit**

```bash
git add src/tagging/resolveTags.ts src/tagging/formatMentions.ts tests/tagging/resolveTags.test.ts tests/tagging/formatMentions.test.ts
git commit -m "feat: resolve @all/@Role tags to members and format mention links"
```

---

### Task 7: Admin permission check

**Files:**
- Create: `src/permissions.ts`
- Test: `tests/permissions.test.ts`

**Interfaces:**
- Produces: `ChatMemberApi { getChatMember(chatId: number, userId: number): Promise<{ status: string }> }`; `isGroupAdmin(api: ChatMemberApi, chatId: number, userId: number): Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

Create `tests/permissions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isGroupAdmin } from "../src/permissions";

describe("isGroupAdmin", () => {
  it("returns true for status 'administrator'", async () => {
    const api = { getChatMember: async () => ({ status: "administrator" }) };
    expect(await isGroupAdmin(api, 1, 100)).toBe(true);
  });

  it("returns true for status 'creator'", async () => {
    const api = { getChatMember: async () => ({ status: "creator" }) };
    expect(await isGroupAdmin(api, 1, 100)).toBe(true);
  });

  it("returns false for status 'member'", async () => {
    const api = { getChatMember: async () => ({ status: "member" }) };
    expect(await isGroupAdmin(api, 1, 100)).toBe(false);
  });

  it("calls getChatMember with the given chatId and userId", async () => {
    let calledWith: [number, number] | undefined;
    const api = {
      getChatMember: async (chatId: number, userId: number) => {
        calledWith = [chatId, userId];
        return { status: "member" };
      },
    };
    await isGroupAdmin(api, 42, 7);
    expect(calledWith).toEqual([42, 7]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/permissions.test.ts`
Expected: FAIL — `Cannot find module '../src/permissions'`

- [ ] **Step 3: Write `src/permissions.ts`**

```ts
export interface ChatMemberApi {
  getChatMember(chatId: number, userId: number): Promise<{ status: string }>;
}

const ADMIN_STATUSES = new Set(["administrator", "creator"]);

export async function isGroupAdmin(api: ChatMemberApi, chatId: number, userId: number): Promise<boolean> {
  const member = await api.getChatMember(chatId, userId);
  return ADMIN_STATUSES.has(member.status);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/permissions.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/permissions.ts tests/permissions.test.ts
git commit -m "feat: add admin permission check"
```

---

### Task 8: Role management command handlers

**Files:**
- Create: `src/commands/roleCommands.ts`
- Test: `tests/commands/roleCommands.test.ts`

**Interfaces:**
- Consumes: `Store`, `Role` from `src/store/types.ts`; `InMemoryStore` for tests.
- Produces:
  - `handleCreateRole(store: Store, chatId: number, name: string): Promise<string>`
  - `handleDeleteRole(store: Store, chatId: number, name: string): Promise<string>`
  - `handleListRoles(store: Store, chatId: number): Promise<string>`
  - Each returns the reply text the bot should send (admin/DM gating is handled by the caller in Task 10, not here).

- [ ] **Step 1: Write the failing test**

Create `tests/commands/roleCommands.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../src/store/inMemoryStore";
import { handleCreateRole, handleDeleteRole, handleListRoles } from "../../src/commands/roleCommands";

describe("role management commands", () => {
  it("creates a role and confirms it", async () => {
    const store = new InMemoryStore();
    const reply = await handleCreateRole(store, 1, "Designers");
    expect(reply).toBe('Role "Designers" created.');
    expect(await store.findRole(1, "Designers")).toBeDefined();
  });

  it("refuses to create a duplicate role", async () => {
    const store = new InMemoryStore();
    await handleCreateRole(store, 1, "Designers");
    const reply = await handleCreateRole(store, 1, "Designers");
    expect(reply).toBe('Role "Designers" already exists.');
  });

  it("deletes an existing role", async () => {
    const store = new InMemoryStore();
    await handleCreateRole(store, 1, "Designers");
    const reply = await handleDeleteRole(store, 1, "Designers");
    expect(reply).toBe('Role "Designers" deleted.');
    expect(await store.findRole(1, "Designers")).toBeUndefined();
  });

  it("reports when deleting a role that does not exist", async () => {
    const store = new InMemoryStore();
    const reply = await handleDeleteRole(store, 1, "Nope");
    expect(reply).toBe('Role "Nope" does not exist.');
  });

  it("lists roles with member counts", async () => {
    const store = new InMemoryStore();
    await store.upsertMember({ chatId: 1, userId: 100, firstName: "Ada" });
    const role = await handleCreateRoleAndReturn(store, 1, "Designers");
    await store.assignUserToRole(role.id, 100);
    await handleCreateRole(store, 1, "Moderators");

    const reply = await handleListRoles(store, 1);
    expect(reply).toBe("Designers (1 member)\nModerators (0 members)");
  });

  it("reports when there are no roles", async () => {
    const store = new InMemoryStore();
    const reply = await handleListRoles(store, 1);
    expect(reply).toBe("No roles have been created yet.");
  });
});

async function handleCreateRoleAndReturn(store: InMemoryStore, chatId: number, name: string) {
  await handleCreateRole(store, chatId, name);
  const role = await store.findRole(chatId, name);
  if (!role) throw new Error("role should exist");
  return role;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/commands/roleCommands.test.ts`
Expected: FAIL — `Cannot find module '../../src/commands/roleCommands'`

- [ ] **Step 3: Write `src/commands/roleCommands.ts`**

```ts
import type { Store } from "../store/types";

export async function handleCreateRole(store: Store, chatId: number, name: string): Promise<string> {
  const existing = await store.findRole(chatId, name);
  if (existing) {
    return `Role "${name}" already exists.`;
  }
  await store.createRole(chatId, name);
  return `Role "${name}" created.`;
}

export async function handleDeleteRole(store: Store, chatId: number, name: string): Promise<string> {
  const existing = await store.findRole(chatId, name);
  if (!existing) {
    return `Role "${name}" does not exist.`;
  }
  await store.deleteRole(chatId, name);
  return `Role "${name}" deleted.`;
}

export async function handleListRoles(store: Store, chatId: number): Promise<string> {
  const roles = await store.listRoles(chatId);
  if (roles.length === 0) {
    return "No roles have been created yet.";
  }

  const lines = await Promise.all(
    roles.map(async (role) => {
      const members = await store.getRoleMembers(role.id);
      const label = members.length === 1 ? "member" : "members";
      return `${role.name} (${members.length} ${label})`;
    }),
  );

  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/commands/roleCommands.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/commands/roleCommands.ts tests/commands/roleCommands.test.ts
git commit -m "feat: add role management command handlers"
```

---

### Task 9: Assignment command handlers

**Files:**
- Create: `src/commands/assignCommands.ts`
- Test: `tests/commands/assignCommands.test.ts`

**Interfaces:**
- Consumes: `Store`, `Member` from `src/store/types.ts`.
- Produces:
  - `handleAssign(store: Store, chatId: number, roleName: string, target: Member | undefined): Promise<string>`
  - `handleUnassign(store: Store, chatId: number, roleName: string, target: Member | undefined): Promise<string>`
  - `handleMyRoles(store: Store, chatId: number, userId: number): Promise<string>`
  - `target` is resolved by the caller (Task 10) from a reply-to-message sender; passing `undefined` represents "no target user identified."

- [ ] **Step 1: Write the failing test**

Create `tests/commands/assignCommands.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../src/store/inMemoryStore";
import { handleAssign, handleUnassign, handleMyRoles } from "../../src/commands/assignCommands";

describe("assignment commands", () => {
  it("assigns a target member to an existing role", async () => {
    const store = new InMemoryStore();
    await store.createRole(1, "Designers");
    const target = { chatId: 1, userId: 100, firstName: "Ada" };
    await store.upsertMember(target);

    const reply = await handleAssign(store, 1, "Designers", target);
    expect(reply).toBe("Ada added to Designers.");

    const role = await store.findRole(1, "Designers");
    const members = await store.getRoleMembers(role!.id);
    expect(members.map((m) => m.userId)).toEqual([100]);
  });

  it("reports when the role does not exist", async () => {
    const store = new InMemoryStore();
    const target = { chatId: 1, userId: 100, firstName: "Ada" };
    await store.upsertMember(target);

    const reply = await handleAssign(store, 1, "Nope", target);
    expect(reply).toBe('Role "Nope" does not exist.');
  });

  it("reports when no target user was identified", async () => {
    const store = new InMemoryStore();
    await store.createRole(1, "Designers");

    const reply = await handleAssign(store, 1, "Designers", undefined);
    expect(reply).toBe(
      "Couldn't identify that user. Reply to one of their messages with this command, and make sure they've posted in this group before.",
    );
  });

  it("unassigns a target member from a role", async () => {
    const store = new InMemoryStore();
    const role = await store.createRole(1, "Designers");
    const target = { chatId: 1, userId: 100, firstName: "Ada" };
    await store.upsertMember(target);
    await store.assignUserToRole(role.id, 100);

    const reply = await handleUnassign(store, 1, "Designers", target);
    expect(reply).toBe("Ada removed from Designers.");

    const members = await store.getRoleMembers(role.id);
    expect(members).toEqual([]);
  });

  it("lists a user's roles", async () => {
    const store = new InMemoryStore();
    const target = { chatId: 1, userId: 100, firstName: "Ada" };
    await store.upsertMember(target);
    const role = await store.createRole(1, "Designers");
    await store.assignUserToRole(role.id, 100);

    const reply = await handleMyRoles(store, 1, 100);
    expect(reply).toBe("Your roles: Designers");
  });

  it("reports when the user has no roles", async () => {
    const store = new InMemoryStore();
    const reply = await handleMyRoles(store, 1, 100);
    expect(reply).toBe("You have no roles in this group.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/commands/assignCommands.test.ts`
Expected: FAIL — `Cannot find module '../../src/commands/assignCommands'`

- [ ] **Step 3: Write `src/commands/assignCommands.ts`**

```ts
import type { Member, Store } from "../store/types";

const NO_TARGET_MESSAGE =
  "Couldn't identify that user. Reply to one of their messages with this command, and make sure they've posted in this group before.";

export async function handleAssign(
  store: Store,
  chatId: number,
  roleName: string,
  target: Member | undefined,
): Promise<string> {
  const role = await store.findRole(chatId, roleName);
  if (!role) {
    return `Role "${roleName}" does not exist.`;
  }
  if (!target) {
    return NO_TARGET_MESSAGE;
  }
  await store.assignUserToRole(role.id, target.userId);
  return `${target.firstName} added to ${roleName}.`;
}

export async function handleUnassign(
  store: Store,
  chatId: number,
  roleName: string,
  target: Member | undefined,
): Promise<string> {
  const role = await store.findRole(chatId, roleName);
  if (!role) {
    return `Role "${roleName}" does not exist.`;
  }
  if (!target) {
    return NO_TARGET_MESSAGE;
  }
  await store.unassignUserFromRole(role.id, target.userId);
  return `${target.firstName} removed from ${roleName}.`;
}

export async function handleMyRoles(store: Store, chatId: number, userId: number): Promise<string> {
  const roles = await store.getUserRoles(chatId, userId);
  if (roles.length === 0) {
    return "You have no roles in this group.";
  }
  return `Your roles: ${roles.map((r) => r.name).join(", ")}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/commands/assignCommands.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/commands/assignCommands.ts tests/commands/assignCommands.test.ts
git commit -m "feat: add role assignment command handlers"
```

---

### Task 10: grammY bot wiring

**Files:**
- Create: `src/bot.ts`

**Interfaces:**
- Consumes: `Store` (Task 2), `isGroupAdmin`/`ChatMemberApi` (Task 7), `handleCreateRole`/`handleDeleteRole`/`handleListRoles` (Task 8), `handleAssign`/`handleUnassign`/`handleMyRoles` (Task 9), `resolveTags`/`formatMentions` (Task 6).
- Produces: `createBot(token: string, store: Store): Bot` — a fully-wired grammY `Bot` instance, used by `api/webhook.ts` (Task 12).

This task has no automated test (it wires real grammY types end-to-end, which is exercised by manual verification in Task 13). Correctness here is checked via `typecheck` and the manual e2e checklist.

- [ ] **Step 1: Write `src/bot.ts`**

```ts
import { Bot } from "grammy";
import type { Store, Member } from "./store/types";
import { isGroupAdmin } from "./permissions";
import { handleCreateRole, handleDeleteRole, handleListRoles } from "./commands/roleCommands";
import { handleAssign, handleUnassign, handleMyRoles } from "./commands/assignCommands";
import { resolveTags } from "./tagging/resolveTags";
import { formatMentions } from "./tagging/formatMentions";

function isGroupChat(chatType: string): boolean {
  return chatType === "group" || chatType === "supergroup";
}

function replyTargetFrom(replyToUser: { id: number; first_name: string; username?: string } | undefined, chatId: number): Member | undefined {
  if (!replyToUser) return undefined;
  return {
    chatId,
    userId: replyToUser.id,
    firstName: replyToUser.first_name,
    username: replyToUser.username,
  };
}

export function createBot(token: string, store: Store): Bot {
  const bot = new Bot(token);

  // Track every poster as a known member of the chat.
  bot.on("message", async (ctx, next) => {
    if (isGroupChat(ctx.chat.type) && ctx.from) {
      await store.upsertMember({
        chatId: ctx.chat.id,
        userId: ctx.from.id,
        firstName: ctx.from.first_name,
        username: ctx.from.username,
      });
    }
    await next();
  });

  bot.command("createrole", async (ctx) => {
    if (!isGroupChat(ctx.chat.type)) return ctx.reply("This command only works in a group.");
    if (!ctx.from || !(await isGroupAdmin(ctx.api, ctx.chat.id, ctx.from.id))) {
      return ctx.reply("Only group admins can create roles.");
    }
    const name = ctx.match.trim();
    if (!name) return ctx.reply("Usage: /createrole <name>");
    return ctx.reply(await handleCreateRole(store, ctx.chat.id, name));
  });

  bot.command("deleterole", async (ctx) => {
    if (!isGroupChat(ctx.chat.type)) return ctx.reply("This command only works in a group.");
    if (!ctx.from || !(await isGroupAdmin(ctx.api, ctx.chat.id, ctx.from.id))) {
      return ctx.reply("Only group admins can delete roles.");
    }
    const name = ctx.match.trim();
    if (!name) return ctx.reply("Usage: /deleterole <name>");
    return ctx.reply(await handleDeleteRole(store, ctx.chat.id, name));
  });

  bot.command("roles", async (ctx) => {
    if (!isGroupChat(ctx.chat.type)) return ctx.reply("This command only works in a group.");
    return ctx.reply(await handleListRoles(store, ctx.chat.id));
  });

  bot.command("assign", async (ctx) => {
    if (!isGroupChat(ctx.chat.type)) return ctx.reply("This command only works in a group.");
    if (!ctx.from || !(await isGroupAdmin(ctx.api, ctx.chat.id, ctx.from.id))) {
      return ctx.reply("Only group admins can assign roles.");
    }
    const name = ctx.match.trim();
    if (!name) return ctx.reply("Usage: reply to a user's message with /assign <role>");
    const target = replyTargetFrom(ctx.message?.reply_to_message?.from, ctx.chat.id);
    return ctx.reply(await handleAssign(store, ctx.chat.id, name, target));
  });

  bot.command("unassign", async (ctx) => {
    if (!isGroupChat(ctx.chat.type)) return ctx.reply("This command only works in a group.");
    if (!ctx.from || !(await isGroupAdmin(ctx.api, ctx.chat.id, ctx.from.id))) {
      return ctx.reply("Only group admins can unassign roles.");
    }
    const name = ctx.match.trim();
    if (!name) return ctx.reply("Usage: reply to a user's message with /unassign <role>");
    const target = replyTargetFrom(ctx.message?.reply_to_message?.from, ctx.chat.id);
    return ctx.reply(await handleUnassign(store, ctx.chat.id, name, target));
  });

  bot.command("myroles", async (ctx) => {
    if (!isGroupChat(ctx.chat.type)) return ctx.reply("This command only works in a group.");
    if (!ctx.from) return;
    return ctx.reply(await handleMyRoles(store, ctx.chat.id, ctx.from.id));
  });

  bot.on("message:text", async (ctx) => {
    if (!isGroupChat(ctx.chat.type)) return;
    const members = await resolveTags(ctx.message.text, store, ctx.chat.id);
    if (members.length === 0) return;
    const mentionText = formatMentions(members);
    await ctx.reply(mentionText, { parse_mode: "Markdown", reply_to_message_id: ctx.message.message_id });
  });

  return bot;
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run typecheck`
Expected: no errors. If grammY's types disagree with the handlers above (e.g. `ctx.match` typing on `bot.command`), adjust the code to match grammY's actual types until this passes — grammY's installed type definitions are authoritative over this plan's snippet.

- [ ] **Step 3: Commit**

```bash
git add src/bot.ts
git commit -m "feat: wire grammY bot with commands and tag-mention listener"
```

---

### Task 11: Supabase-backed store

**Files:**
- Create: `src/store/supabaseStore.ts`

**Interfaces:**
- Consumes: `Store`, `Member`, `Role` from `src/store/types.ts`; `supabase/schema.sql` table shapes (Task 1).
- Produces: `class SupabaseStore implements Store`, constructed as `new SupabaseStore(url: string, serviceRoleKey: string)`.

This task has no automated test (it requires a live Supabase project). It is verified manually in Task 13 against a real Supabase instance. Type-correctness is verified via `typecheck`.

- [ ] **Step 1: Write `src/store/supabaseStore.ts`**

```ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Member, Role, Store } from "./types";

export class SupabaseStore implements Store {
  private client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey);
  }

  async upsertMember(member: Member): Promise<void> {
    await this.client.from("groups").upsert({ chat_id: member.chatId });
    const { error } = await this.client.from("members").upsert({
      chat_id: member.chatId,
      user_id: member.userId,
      username: member.username ?? null,
      first_name: member.firstName,
    });
    if (error) throw error;
  }

  async getMembers(chatId: number): Promise<Member[]> {
    const { data, error } = await this.client.from("members").select("*").eq("chat_id", chatId);
    if (error) throw error;
    return (data ?? []).map(rowToMember);
  }

  async getMember(chatId: number, userId: number): Promise<Member | undefined> {
    const { data, error } = await this.client
      .from("members")
      .select("*")
      .eq("chat_id", chatId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToMember(data) : undefined;
  }

  async createRole(chatId: number, name: string): Promise<Role> {
    const { data, error } = await this.client
      .from("roles")
      .insert({ chat_id: chatId, name })
      .select()
      .single();
    if (error) throw error;
    return rowToRole(data);
  }

  async deleteRole(chatId: number, name: string): Promise<void> {
    const { error } = await this.client.from("roles").delete().eq("chat_id", chatId).eq("name", name);
    if (error) throw error;
  }

  async findRole(chatId: number, name: string): Promise<Role | undefined> {
    const { data, error } = await this.client
      .from("roles")
      .select("*")
      .eq("chat_id", chatId)
      .eq("name", name)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToRole(data) : undefined;
  }

  async listRoles(chatId: number): Promise<Role[]> {
    const { data, error } = await this.client.from("roles").select("*").eq("chat_id", chatId);
    if (error) throw error;
    return (data ?? []).map(rowToRole);
  }

  async assignUserToRole(roleId: string, userId: number): Promise<void> {
    const { error } = await this.client.from("role_members").upsert({ role_id: Number(roleId), user_id: userId });
    if (error) throw error;
  }

  async unassignUserFromRole(roleId: string, userId: number): Promise<void> {
    const { error } = await this.client
      .from("role_members")
      .delete()
      .eq("role_id", Number(roleId))
      .eq("user_id", userId);
    if (error) throw error;
  }

  async getRoleMembers(roleId: string): Promise<Member[]> {
    const { data: role, error: roleError } = await this.client
      .from("roles")
      .select("*")
      .eq("id", Number(roleId))
      .maybeSingle();
    if (roleError) throw roleError;
    if (!role) return [];

    const { data: links, error: linksError } = await this.client
      .from("role_members")
      .select("user_id")
      .eq("role_id", Number(roleId));
    if (linksError) throw linksError;

    const userIds = (links ?? []).map((l) => l.user_id);
    if (userIds.length === 0) return [];

    const { data: members, error: membersError } = await this.client
      .from("members")
      .select("*")
      .eq("chat_id", role.chat_id)
      .in("user_id", userIds);
    if (membersError) throw membersError;

    return (members ?? []).map(rowToMember);
  }

  async getUserRoles(chatId: number, userId: number): Promise<Role[]> {
    const { data, error } = await this.client
      .from("role_members")
      .select("role_id, roles!inner(id, chat_id, name)")
      .eq("roles.chat_id", chatId)
      .eq("user_id", userId);
    if (error) throw error;
    return (data ?? []).map((row: any) => rowToRole(row.roles));
  }
}

function rowToMember(row: any): Member {
  return {
    chatId: row.chat_id,
    userId: row.user_id,
    firstName: row.first_name,
    username: row.username ?? undefined,
  };
}

function rowToRole(row: any): Role {
  return { id: String(row.id), chatId: row.chat_id, name: row.name };
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/store/supabaseStore.ts
git commit -m "feat: add Supabase-backed Store implementation"
```

---

### Task 12: Vercel webhook handler and webhook-registration script

**Files:**
- Create: `api/webhook.ts`
- Create: `scripts/set-webhook.ts`

**Interfaces:**
- Consumes: `createBot` (Task 10), `SupabaseStore` (Task 11).
- Produces: the deployed HTTP endpoint Telegram calls, and a one-off CLI script to register that endpoint as the bot's webhook.

- [ ] **Step 1: Write `api/webhook.ts`**

```ts
import { webhookCallback } from "grammy";
import type { IncomingMessage, ServerResponse } from "http";
import { createBot } from "../src/bot";
import { SupabaseStore } from "../src/store/supabaseStore";

const token = process.env.BOT_TOKEN;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!token || !supabaseUrl || !supabaseKey) {
  throw new Error("Missing BOT_TOKEN, SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY environment variable");
}

const store = new SupabaseStore(supabaseUrl, supabaseKey);
const bot = createBot(token, store);
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

- [ ] **Step 2: Write `scripts/set-webhook.ts`**

```ts
import { Bot } from "grammy";

const token = process.env.BOT_TOKEN;
const webhookUrl = process.env.WEBHOOK_URL;

if (!token || !webhookUrl) {
  throw new Error("Missing BOT_TOKEN or WEBHOOK_URL environment variable");
}

const bot = new Bot(token);

async function main() {
  await bot.api.setWebhook(webhookUrl!);
  console.log(`Webhook set to ${webhookUrl}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Verify it type-checks**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add api/webhook.ts scripts/set-webhook.ts
git commit -m "feat: add Vercel webhook handler and webhook-registration script"
```

---

### Task 13: Manual end-to-end verification

**Files:** none (deployment and manual testing checklist — no code changes)

This is the spec's required manual verification step. Automated tests cannot cover real Telegram/Supabase/Vercel integration, so this task is a checklist to run by hand before considering the feature done.

- [ ] **Step 1: Create the Supabase project and apply the schema**

In the Supabase dashboard: create a new project, open the SQL editor, paste the contents of `supabase/schema.sql`, and run it. Confirm the four tables (`groups`, `members`, `roles`, `role_members`) appear in the table editor.

- [ ] **Step 2: Create the Telegram bot and get a token**

Message `@BotFather` on Telegram, run `/newbot`, follow the prompts, and copy the resulting bot token.

- [ ] **Step 3: Deploy to Vercel**

```bash
npx vercel --prod
```

In the Vercel project settings, set environment variables `BOT_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (from the Supabase project's API settings), matching `.env.example`. Redeploy after setting them so the function picks them up.

- [ ] **Step 4: Register the webhook**

Locally, create a `.env` (not committed) with `BOT_TOKEN`, and `WEBHOOK_URL` set to `https://<your-vercel-domain>/api/webhook`. Run:

```bash
npm run set-webhook
```

Expected output: `Webhook set to https://<your-vercel-domain>/api/webhook`

- [ ] **Step 5: Verify in a real Telegram group**

Create a test group, add the bot, make the bot an admin (Telegram requires this for it to read all messages and check member status reliably). Then, as the group's admin:

1. Send `/createrole Designers` — expect `Role "Designers" created.`
2. Send another message as a second test account so the bot records that user.
3. Reply to that user's message with `/assign Designers` — expect `<name> added to Designers.`
4. Send `/roles` — expect `Designers (1 member)`.
5. Send `@Designers ping` — expect a reply containing a clickable mention of that user.
6. Send `@all` — expect a reply mentioning every user who has posted in the group.
7. As a non-admin account, attempt `/createrole Foo` — expect `Only group admins can create roles.`
8. Send `@NotARole` — expect no reply at all.

- [ ] **Step 6: Record the outcome**

If all steps in Step 5 behave as expected, the feature is verified end-to-end. If any step fails, return to the relevant task above, fix the issue, redeploy, and re-run the checklist from the failing step.
