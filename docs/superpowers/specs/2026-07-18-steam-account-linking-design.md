# Steam Account Linking — Design

## Overview

Lets any Telegram group member link their Steam account to their identity within a specific group chat. This is the foundation sub-project for a larger CS2 highlight-generation feature: once accounts are linked, a later sub-project will poll for new matches, another will render highlight clips, and another will upload them to a pre-linked YouTube channel. Those are out of scope here and will get their own design docs once this piece is built and working.

**Goals:**
- Verify Steam account ownership via Steam's own login (no manual "type your SteamID" trust-me flow).
- Fit the existing zero-cost architecture (Vercel serverless + Supabase) with no new infrastructure.
- Scope links per-group like existing roles/members, since the same person may be in multiple brotag groups.

**Non-goals:**
- Fetching match history, demos, or generating highlights (future sub-projects).
- Supporting linking outside of a Telegram group context.

## Architecture

- **Runtime:** Same Vercel serverless deployment as the existing bot. Two new routes are added alongside `api/webhook.ts`:
  - `api/steam-link/start.ts` — begins the Steam OpenID redirect.
  - `api/steam-link/callback.ts` — handles Steam's redirect back, verifies the response, stores the link.
- **Auth protocol:** Steam OpenID 2.0 (`https://steamcommunity.com/openid/`). No Steam API key is required for this flow — verification is done by POSTing the returned parameters back to Steam's `check_authentication` endpoint and confirming `is_valid:true`.
- **Flow:**
  1. User runs `/linksteam` in a group.
  2. Bot generates a random single-use token, stores it with the chat_id/user_id and a 10-minute expiry in `steam_link_tokens`, and replies with a link to `/steam-link/start?token=...`.
  3. User opens the link in a browser (outside Telegram). `start` looks up the token (rejecting if missing/expired), then redirects to Steam's OpenID login with the callback URL and token embedded as `state`.
  4. User logs into Steam and approves. Steam redirects to `/steam-link/callback?...&openid.claimed_id=...`.
  5. `callback` verifies the response with Steam, extracts the `steamid64` from `claimed_id` (format `https://steamcommunity.com/openid/id/<steamid64>`), upserts `(chat_id, user_id) -> steam_id64` into `steam_links`, deletes the used token, and renders a plain confirmation page.
  6. User returns to Telegram and can check `/mysteam`.

## Data Model (Supabase / Postgres)

```sql
steam_link_tokens (
  token       text primary key,
  chat_id     bigint not null,
  user_id     bigint not null,
  expires_at  timestamptz not null
)

steam_links (
  chat_id     bigint not null,
  user_id     bigint not null,
  steam_id64  text not null,
  linked_at   timestamptz not null default now(),
  primary key (chat_id, user_id)
)
```

- Linking again overwrites the existing row for that `(chat_id, user_id)` (re-linking replaces, doesn't duplicate).
- No foreign key to `groups`/`members` is required for this feature to function, though both tables already exist from the role-tag feature and share the same `chat_id` shape.

## Commands

All commands operate only inside groups (rejected with a short message if used in a DM to the bot, matching existing command behavior).

- `/linksteam` — generates a token and replies with the one-time link. Open to any group member (no admin check).
- `/mysteam` — replies with the caller's linked SteamID64, or "You haven't linked a Steam account yet — run /linksteam."
- `/unlinksteam` — deletes the caller's row from `steam_links` for this chat; replies with confirmation either way.

## Error Handling

- Token missing, already used, or expired (`start` or `callback`): render a plain page — "This link has expired. Go back to Telegram and run /linksteam again." No stack traces or internal details shown.
- Steam `check_authentication` returns `is_valid:false`, or the request fails outrightly: same friendly error page, full details logged server-side only.
- Malformed `claimed_id` (shouldn't happen from a real Steam response, but defensively checked): same friendly error page.

## Testing

Following the existing `tests/commands` and `tests/store` structure:
- Unit tests for the OpenID `check_authentication` verification logic, mocking Steam's HTTP response for both valid and invalid cases.
- Unit tests for token generation/expiry/single-use behavior.
- Unit tests for the store methods (`linkSteam`, `unlinkSteam`, `getSteamLink`) against the in-memory store, matching how existing store methods are tested.
- Command tests for `/linksteam`, `/mysteam`, `/unlinksteam` (group-only enforcement, happy path, not-linked path), matching the pattern in `tests/commands`.
