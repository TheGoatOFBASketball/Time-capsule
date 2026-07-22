-- =============================================================================
-- 0005_factions.sql — Faction Wars schema (auth + memberships + RLS).
--
-- Run AFTER 0004_tile_addons.sql. Idempotent. Also depends on Supabase Auth
-- being enabled in the project (which it is by default — see
-- supabase.com/dashboard → Authentication).
--
-- Two new tables:
--   factions           — public, leader-owned, color-themed
--   factions_members   — leader + member rows; one leader per faction
--
-- + the FK to factions from tiles (which 0004 added as a free-standing uuid).
--
-- Auth model:
--   • Single-tile purchases still anonymous. The Stripe webhook writes tile
--     rows via service_role which bypasses RLS.
--   • Faction creation requires an authenticated user (auth.uid()). The
--     leader creates the faction with leader_user_id = auth.uid() (verified
--     by RLS) and inserts their own factions_members row as 'leader' in
--     the same Netlify function call (server-side, post-auth-verify).
--   • Block reservations: the leader is still the Stripe customer (their
--     `auth.uid()` is the buyer's Stripe customer by metadata.link). Tiles
--     are inserted by the webhook with faction_id set; tiles are owned by
--     the faction, the buyer's $ are paid by the leader.
--
-- Cross-table safety:
--   The tiles table's "no public select on lock_*" doesn't exist — anyone
--   can read whether a tile has lock_kind set. The actual lock_hash is sent
--   ONLY via the dedicated `unlock-tile` endpoint that scrypt-compares;
--   the home page subscription payload includes the row but the client
--   side checks `lock_kind` before showing the message. The unlock endpoint
--   is the AVENUE for revealing the message text to non-authors.
-- =============================================================================

create extension if not exists "pgcrypto";  -- for gen_random_uuid()

-- ----- factions -----
create table if not exists public.factions (
  id              uuid          primary key default gen_random_uuid(),
  name            varchar(40)   not null unique
                  check (char_length(name) between 1 and 40),
  leader_user_id  uuid          not null,
  palette         text          not null default '#a45a76',
  description     varchar(280)  check (char_length(description) <= 280),
  created_at      timestamptz   not null default now()
);

create index if not exists factions_leader_idx on public.factions (leader_user_id);

-- ----- factions_members -----
do $$
begin
  if not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'factions_members'
  ) then
    create table public.factions_members (
      faction_id  uuid        not null references public.factions(id) on delete cascade,
      user_id     uuid        not null,
      role        text        not null default 'member'
                   check (role in ('leader','member')),
      joined_at   timestamptz not null default now(),
      primary key (faction_id, user_id)
    );
  end if;
end
$$;
create index if not exists factions_members_user_idx on public.factions_members (user_id);

-- ----- back-fill tiles.faction_id FK now that factions exists -----
-- (No-op if already constrained via a previous run; we don't add the FK
-- because 0004 ran ahead. Adding it now keeps referential integrity.)
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'tiles_faction_id_fkey'
  ) then
    alter table public.tiles
      add constraint tiles_faction_id_fkey
      foreign key (faction_id) references public.factions(id) on delete set null;
  end if;
end
$$;

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.factions        enable row level security;
alter table public.factions_members enable row level security;

-- Read: anyone — factions are public.
drop policy if exists "factions_select_for_all" on public.factions;
create policy "factions_select_for_all"
  on public.factions for select
  to anon, authenticated
  using (true);

drop policy if exists "factions_members_select_for_all" on public.factions_members;
create policy "factions_members_select_for_all"
  on public.factions_members for select
  to anon, authenticated
  using (true);

-- Insert factions: only the row's leader_user_id can equal auth.uid().
-- This means a logged-in user can create a faction and bind themselves as
-- leader. We do NOT allow impersonation (leader_user_id pinned to auth.uid()).
drop policy if exists "factions_insert_self_leader" on public.factions;
create policy "factions_insert_self_leader"
  on public.factions for insert
  to authenticated
  with check (leader_user_id = auth.uid());

-- Update factions: only the leader can rename or recolor.
drop policy if exists "factions_update_leader_only" on public.factions;
create policy "factions_update_leader_only"
  on public.factions for update
  to authenticated
  using (leader_user_id = auth.uid())
  with check (leader_user_id = auth.uid());

-- factions_members: only the faction's leader can INSERT or DELETE rows.
-- That means a non-leader can never insert themselves as a leader. New
-- factions' initial leader row is added server-side in faction-create.js
-- (Netlify function) where we are already authenticated.
drop policy if exists "factions_members_modify_leader_only" on public.factions_members;
create policy "factions_members_modify_leader_only"
  on public.factions_members for all
  to authenticated
  using (
    exists (
      select 1 from public.factions f
      where f.id = faction_id and f.leader_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.factions f
      where f.id = faction_id and f.leader_user_id = auth.uid()
    )
  );

-- Tiles: the "no anon INSERT / no update / no delete" policies from 0003
-- still apply. Faction-linked tiles reach the table via service_role (Stripe
-- webhook) so they bypass RLS. Faction metadata edits use the policies above.

-- =============================================================================
-- Realtime — broadcast faction roster changes so anyone viewing the faction's
-- tiles sees its members update live.
-- =============================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename = 'factions'
  ) then
    alter publication supabase_realtime add table public.factions;
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename = 'factions_members'
  ) then
    alter publication supabase_realtime add table public.factions_members;
  end if;
end
$$;
