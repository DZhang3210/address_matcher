-- Schema for the anonymous answer log (applied to the Supabase project "same-place").
-- The game writes here from src/lib/telemetry.ts; see public/privacy.html for what players are told.

-- One row per answer in the "Same Place?" game. Anonymous: no IP, account or free text.
create table public.answers (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  session_id    uuid not null,           -- random per browser tab visit; not stored across visits
  round_id      uuid not null,           -- random per round
  position      smallint not null check (position between 0 and 9999),  -- 0-based index in the round
  pair_id       text not null check (char_length(pair_id) between 1 and 100),
  guess         boolean not null,        -- true = "same place"
  correct       boolean not null,
  response_ms   integer not null check (response_ms between 0 and 3600000),
  was_hidden    boolean not null,        -- tab was in the background while this pair was shown
  opponent      text check (opponent is null or char_length(opponent) between 1 and 32),
  difficulty    text not null check (difficulty in ('any', 'easy', 'medium', 'hard')),
  device        text not null check (device in ('phone', 'desktop')),
  app_version   text not null check (char_length(app_version) between 1 and 32)  -- "-dev" suffix = local testing
);

comment on table public.answers is 'Anonymous answers from the Same Place? game. Insert-only for the public key.';

alter table public.answers enable row level security;

-- The public (anon) key may add rows and nothing else: no select, update or delete policies exist.
create policy "anyone can insert answers"
  on public.answers for insert
  to anon
  with check (true);

revoke all on public.answers from anon, authenticated;
grant insert on public.answers to anon;

create index answers_pair_id_idx on public.answers (pair_id);
create index answers_session_id_idx on public.answers (session_id);
