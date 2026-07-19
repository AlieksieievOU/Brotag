# CS2 Match Detection & Queue — Design

## Overview

Sub-project #2 of the CS2 highlights feature. Detects new CS2 matches played by linked group members by walking Steam's match share codes, records each newly seen match in a queue table for the future render worker (sub-project #3), and posts a short notification in the group. Builds directly on sub-project #1 (Steam account linking): only users with a `steam_links` row can enroll.

**Goals:**
- Detect a linked member's new CS2 matches within ~15 minutes of Steam exposing them.
- Persist detected matches in a queue that later sub-projects consume (`match_queue` is the contract between #2 and #3).
- Stay on the existing zero-cost stack: Vercel serverless + Supabase, with GitHub Actions as the only new (also free) moving part.

**Non-goals:**
- Downloading `.dem` demo files (requires a persistent Game Coordinator session — sub-project #3).
- Any highlight rendering or video work.
- Match details (map, score, K/D). At this stage a match is just a share code.

## Architecture

- **Trigger:** A GitHub Actions scheduled workflow (`.github/workflows/poll-matches.yml`, `schedule: cron` every 15 minutes plus `workflow_dispatch` for manual runs) curls the deployed endpoint with a bearer token. GitHub throttles schedules under load, so real cadence may stretch toward 30–60 min; acceptable.
- **Endpoint:** New Vercel route `api/poll-matches.ts` (POST only). Rejects requests without `Authorization: Bearer $POLL_SECRET` with 401. On success returns 200 with a JSON summary `{ checked, newMatches, brokenAuth }`. All polling logic lives in `src/` pure functions; the route is a thin wrapper, matching the repo's existing route pattern.
- **Steam API:** `GET https://api.steampowered.com/ICSGOPlayers_730/GetNextMatchSharingCode/v1/?key=<STEAM_API_KEY>&steamid=<steam_id64>&steamidkey=<auth_code>&knowncode=<last_share_code>`. Returns the next share code after `knowncode`, a marker meaning "no newer match", or an auth error for a bad/expired `steamidkey`. The exact response shapes (and the auth-failure status code) must be captured from the live API during implementation — public docs are thin; the implementation treats "HTTP 403 or 401" as broken auth and any 2xx body without a next code as "up to date".
- **Notifications:** Sent from the poll endpoint via grammY's `Api` class directly (`new Api(BOT_TOKEN)` — no webhook context involved), one message per newly queued match.

## Data Model (Supabase / Postgres — new migration, RLS enabled like all tables)

```sql
cs2_tracking (
  chat_id          bigint not null,
  user_id          bigint not null,
  auth_code        text not null,
  last_share_code  text not null,
  status           text not null default 'active',  -- 'active' | 'broken'
  primary key (chat_id, user_id)
)

match_queue (
  id           bigserial primary key,
  chat_id      bigint not null,
  share_code   text not null,
  detected_at  timestamptz not null default now(),
  status       text not null default 'detected',   -- consumed/advanced by sub-project #3
  player_ids   bigint[] not null,                  -- linked users known to be in this match
  unique (chat_id, share_code)
)
```

- `cs2_tracking` requires an existing `steam_links` row for the same `(chat_id, user_id)`; the steam_id64 is read from there at poll time (no duplication).
- Dedupe: two tracked users in the same match walk to the same share code; the unique constraint makes the second insert an update that appends to `player_ids` instead (upsert-and-merge), and only the first insert produces a notification.

## Poll Flow

For each `cs2_tracking` row with `status = 'active'` (all chats, sequentially):

1. Look up the user's `steam_id64` from `steam_links`; if the link was removed, mark tracking `broken` (the notification tells them to `/linksteam` first).
2. Call `GetNextMatchSharingCode` with `knowncode = last_share_code`.
3. **New code returned:** update `last_share_code`, upsert into `match_queue`, loop to step 2 (a user may have several unseen matches). Cap at 10 codes per user per cycle as a runaway guard.
4. **No newer match:** done with this user.
5. **Auth failure:** set `status = 'broken'`, post one group message telling that user their auth code stopped working, with the regeneration link (see Commands). No repeat nagging — `broken` rows are skipped until the user re-runs `/trackcs2`.
6. **Any other error (network, 5xx, rate limit):** log it, skip this user this cycle, continue with the next; never mark `broken` for transient errors.

After the sweep, for each row *newly inserted* into `match_queue` this cycle, post: `🎮 New match detected for <names> — queued for highlights.` (names = first names of `player_ids` from `members`).

The endpoint is fast enough for Vercel's 10s budget at this scale (a handful of tracked users, one or two HTTP calls each); if a cycle ever exceeds the budget, the next cycle resumes from the advanced `last_share_code` values — no lost matches, at most delayed notifications for codes already advanced past.

## Commands

All group-only, matching existing conventions:

- `/trackcs2 <auth-code> <share-code>` — enrolls the caller. Requires `/linksteam` first (rejected with a pointer otherwise). Validates formats (`auth-code` like `XXXX-XXXXX-XXXX`, share code matching `CSGO-([A-Za-z0-9]{5}-){4}[A-Za-z0-9]{5}` — exact patterns pinned down during implementation against real codes). Overwrites any previous enrollment and resets `status` to `active`.
- `/trackcs2` with no/malformed args — replies with the how-to guide:
  1. Open https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730&issueid=128 signed in with the Steam account you linked.
  2. Click "Create authentication code" → that's your `<auth-code>`.
  3. The same page shows "Your most recently completed match token" → that's your `<share-code>`.
  4. Run `/trackcs2 <auth-code> <share-code>`.
- `/untrackcs2` — deletes the caller's `cs2_tracking` row.
- `/mysteam` — extended to also report tracking status: not tracking / active / broken.
- `/help` — gains lines for the two new commands.

The broken-auth notification reuses the same help URL, since re-issuing follows the same steps.

## Configuration

- `STEAM_API_KEY` — operator's Steam Web API key (steamcommunity.com/dev/apikey), new required env var for the poll route only.
- `POLL_SECRET` — shared bearer token; already provisioned in Vercel (Production), GitHub repo secrets, and local `.env` on 2026-07-19.
- `BOT_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — reused by the poll route.
- `.env.example` gains `STEAM_API_KEY=` and `POLL_SECRET=`.

## Error Handling

- Endpoint auth failure → 401, empty body, logged.
- Missing env vars → module-load throw (same fail-fast pattern as existing routes).
- Steam wholesale down → every user hits step 6, cycle logs and returns `{ checked: N, newMatches: 0, brokenAuth: 0 }`; no chat noise.
- Telegram send failure for a notification → logged, does not roll back the queue row (the match is still queued for rendering; a missed notification is acceptable).
- All user-facing texts are short friendly lines; internals only in logs.

## Testing

Existing conventions: pure logic in `src/`, tested with Vitest against `InMemoryStore` (extended with the new store methods) and mocked `fetch` for Steam and Telegram.

- Share-code walk: new-code loop with cap, "no newer match" stop, auth-failure marking, transient-error skip.
- Dedupe: two users walking to the same share code produce one queue row with both `player_ids` and one notification.
- Command handlers: enrollment guard (no steam link), format validation, instruction reply, untrack, `/mysteam` status extension.
- Endpoint wrapper: bearer check (401 vs 200) — thin-wrapper level, like existing route tests conventions (none — verified via typecheck + handler tests).
