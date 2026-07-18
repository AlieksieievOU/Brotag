create table if not exists steam_link_tokens (
  token       text primary key,
  chat_id     bigint not null,
  user_id     bigint not null,
  expires_at  timestamptz not null
);

create table if not exists steam_links (
  chat_id     bigint not null,
  user_id     bigint not null,
  steam_id64  text not null,
  linked_at   timestamptz not null default now(),
  primary key (chat_id, user_id)
);
