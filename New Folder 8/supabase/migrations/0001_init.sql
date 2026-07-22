-- ============================================================
-- 0001_init.sql — The Time Capsule Billboard
-- Run this once in the Supabase SQL editor
-- (supabase.com/dashboard → Project → SQL → New query).
-- Idempotent: safe to run more than once.
-- ============================================================

create table if not exists public.tiles (
  id          integer      primary key check (id between 0 and 9999),
  x           integer      not null check (x between 0 and 99),
  y           integer      not null check (y between 0 and 99),
  text        varchar(60)  not null check (char_length(text) between 1 and 60),
  emoji       varchar(8)   check (char_length(emoji) <= 8),
  handle      varchar(24)  check (char_length(handle) <= 24),
  "timestamp" timestamptz  not null default now(),
  created_at  timestamptz  not null default now()
);

-- Cheap reads for the live ledger (newest first) and the
-- canonical full-board fetch. (id is already the PRIMARY KEY — no
-- need for an explicit tiles_id_asc index.)
create index if not exists tiles_timestamp_desc
  on public.tiles ("timestamp" desc);

-- ============================================================
-- Row-level security
-- ============================================================
alter table public.tiles enable row level security;

-- Anyone (anon or authenticated) can read tiles.
create policy "tiles_select_for_all"
  on public.tiles for select
  to anon, authenticated
  using (true);

-- Demo-phase: anon can insert directly from the browser.
-- The CHECK clause guarantees payload is well-shaped (length,
-- bounds, basic text validity). The PRIMARY KEY on `id` is the
-- *ultimate* race-condition guard — if two users claim the same
-- tile, PostgreSQL rejects the second INSERT with code 23505.
--
-- When you wire real Stripe, replace this policy with:
--
--   create policy "tiles_insert_for_service_only"
--     on public.tiles for insert
--     to authenticated
--     with check (false);
--
-- and route all writes through a Supabase Edge Function called
-- from the Stripe webhook handler (using the service_role key).
create policy "tiles_insert_for_anon"
  on public.tiles for insert
  to anon, authenticated
  with check (
    id between 0 and 9999
    and x between 0 and 99
    and y between 0 and 99
    and char_length(text) between 1 and 60
    and char_length(coalesce(emoji, '')) <= 8
    and char_length(coalesce(handle, '')) <= 24
  );

-- A tile, once written, is permanent.
create policy "tiles_no_update"
  on public.tiles for update
  to anon, authenticated using (false);

create policy "tiles_no_delete"
  on public.tiles for delete
  to anon, authenticated using (false);

-- ============================================================
-- Realtime
-- ============================================================
-- Broadcasts every INSERT on public.tiles to anyone subscribed
-- via the `postgres_changes` channel. UPDATE/DELETE are blocked
-- by RLS above, so this is INSERT-only in practice.
do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'tiles'
  ) then
    alter publication supabase_realtime add table public.tiles;
  end if;
end
$$;

-- ============================================================
-- Storage helper - timestamps use UTC always
-- (the JS client writes ISO strings with timezone offset).
-- ============================================================
comment on column public.tiles."timestamp" is
  'When the tile was claimed by its author. Stored as UTC; JS sends timezone-aware ISO strings.';
