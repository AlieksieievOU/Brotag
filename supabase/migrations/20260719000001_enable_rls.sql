-- The bot accesses these tables exclusively with the service role key, which
-- bypasses RLS. Enabling RLS with no policies closes off all Data API access
-- via the anon/authenticated (publishable) keys.
alter table groups enable row level security;
alter table members enable row level security;
alter table roles enable row level security;
alter table role_members enable row level security;
alter table steam_link_tokens enable row level security;
alter table steam_links enable row level security;
