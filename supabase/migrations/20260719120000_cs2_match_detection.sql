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
