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
