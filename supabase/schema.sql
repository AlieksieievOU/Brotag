create table groups (
  chat_id bigint primary key,
  title text
);

create table members (
  chat_id bigint references groups(chat_id) on delete cascade,
  user_id bigint not null,
  username text,
  first_name text not null,
  -- Recurring birthday, "MM-DD" (no year), set via /setbirthday.
  birthday text,
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

create table cs2_tracking (
  chat_id          bigint not null,
  user_id          bigint not null,
  auth_code        text not null,
  last_share_code  text not null,
  status           text not null default 'active',
  primary key (chat_id, user_id)
);

create table match_queue (
  id           bigserial primary key,
  chat_id      bigint not null,
  share_code   text not null,
  detected_at  timestamptz not null default now(),
  status       text not null default 'detected',
  player_ids   bigint[] not null,
  unique (chat_id, share_code)
);

-- The bot accesses these tables exclusively with the service role key, which
-- bypasses RLS. Enabling RLS with no policies closes off all Data API access
-- via the anon/authenticated (publishable) keys.
alter table groups enable row level security;
alter table members enable row level security;
alter table roles enable row level security;
alter table role_members enable row level security;
alter table steam_link_tokens enable row level security;
alter table steam_links enable row level security;
alter table cs2_tracking enable row level security;
alter table match_queue enable row level security;
