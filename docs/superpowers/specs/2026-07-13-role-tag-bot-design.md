# Telegram Role-Tag Bot — Design

## Overview

A Telegram bot that brings Discord-style role mentions (`@all`, `@RoleName`) to Telegram groups. Group admins define custom roles and assign members to them; any group member can then tag `@all` or a specific role in a message, and the bot replies with clickable mentions for everyone in that role.

**Goals:**
- Reusable across many independent groups (multi-tenant).
- Zero-cost to run: Vercel free tier + Supabase free tier.
- Minimal moving parts — no separate management UI, everything happens via chat commands.

**Non-goals:**
- No support for very large groups (10,000s of members) — target use case is small/medium groups (tens of members). Message-batching for Telegram's 4096-char limit is explicitly out of scope for v1.
- No web dashboard.

## Architecture

- **Runtime:** Vercel serverless function (Node.js), single route `/api/webhook`.
- **Bot framework:** [grammY](https://grammy.dev), TypeScript-first, has an official Vercel `webhookCallback` adapter.
- **Database:** Supabase Postgres (free tier), accessed via `@supabase/supabase-js` from the serverless function.
- **Deployment flow:** On deploy, call Telegram's `setWebhook` once (via a small setup script) pointing at the Vercel function URL. Telegram pushes every update (message, command, etc.) to that endpoint as an HTTP POST.
- Each invocation is stateless: parse the incoming update → route through grammY handlers → read/write Supabase → reply → return 200.

## Data Model (Supabase / Postgres)

```sql
groups (
  chat_id     bigint primary key,
  title       text
)

members (
  chat_id     bigint references groups(chat_id),
  user_id     bigint,
  username    text,
  first_name  text,
  primary key (chat_id, user_id)
)

roles (
  id          bigserial primary key,
  chat_id     bigint references groups(chat_id),
  name        text not null,
  unique (chat_id, name)
)

role_members (
  role_id     bigint references roles(id),
  user_id     bigint,
  primary key (role_id, user_id)
)
```

- A row is upserted into `members` the first time a user is observed sending any message in a group. This is required because Telegram only exposes a user's ID/name to the bot once it has seen them post — there is no way to enumerate a group's membership up front.
- `@all` is a **virtual role**: it resolves to every row in `members` for the current `chat_id`. It has no row in `roles`.

## Commands

All commands operate only inside groups (rejected with a short message if used in a DM to the bot).

**Role management — admin-only** (enforced via a live `getChatMember` check on every call, not cached, since admin status can change):
- `/createrole <name>` — create a role in this group
- `/deleterole <name>` — delete it (and its `role_members` rows)
- `/assign <name> @user` — add a user to a role (also works as a reply to that user's message, using the replied-to message's sender)
- `/unassign <name> @user` — remove a user from a role
- `/roles` — list all roles in this group with member counts
- `/myroles` — show the calling user their own role memberships

**Tagging — open to anyone:**
- Typing `@all` or `@RoleName` anywhere in a normal message triggers the bot.
- The bot scans incoming message text for these tokens (via a grammY text listener + regex), resolves each to a user-ID list (`members` for `@all`, `role_members` joined to `roles` for a named role), deduplicates across multiple tags in the same message, and replies to that message with one line per user formatted as a text-mention: `[First Name](tg://user?id=12345)`. This renders as a clickable, notification-triggering mention without requiring the user to have a public `@username`.
- An unrecognized role tag (e.g. a typo like `@Fooo`) is silently ignored — no reply — so ordinary conversation isn't spammed with error messages.

## Permissions

- Role management commands: caller must be a Telegram group admin (checked per-call).
- Tagging (`@all`/`@RoleName`): no restriction — any group member can trigger it.

## Error Handling

- Unknown role tagged → ignored silently (see above).
- `/assign` / `/unassign` targeting a user the bot has never seen post → reply explaining the user must send at least one message in the group first, so the bot can capture their ID.
- Duplicate `/createrole` for an existing name in that chat → friendly "role already exists" reply, no crash.
- Any webhook-handling error (malformed payload, DB failure) → still return HTTP 200 to Telegram (required, otherwise Telegram retries aggressively) and log the error server-side via Vercel's logging.

## Out of Scope for v1

- Batching/splitting replies for groups large enough to hit Telegram's 4096-character message limit (target groups are ≤ ~10 members).
- Web dashboard for role management.
- Self-service role join (`/iam`-style) — roles are admin-assigned only.

## Testing Strategy

- **Unit tests:** tag-token parsing (extracting `@all`/`@Role` from arbitrary message text), deduplication, and mention-link formatting — pure functions, no Telegram or DB dependency.
- **Integration tests:** command handlers (create/delete role, assign/unassign, permission checks) against a local or test Supabase instance.
- **Manual verification:** end-to-end run in a real Telegram test group before considering the feature done.
