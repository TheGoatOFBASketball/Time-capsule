-- =============================================================================
-- 0004_tile_addons.sql — per-tile add-ons: tiers, audio chips, locks, faction.
--
-- Run AFTER 0003_harden_rls.sql. Idempotent.
--
-- New columns on `public.tiles` (all nullable / zero-default so existing rows
-- stay valid):
--
--   tier                  text         — 'legendary' | 'corner' | 'prime' | null
--   audio_chip_id         text         — catalog id (e.g. 'mario-coin'); null = no chip
--   lock_kind             text         — 'passphrase' | null
--   lock_salt             text         — scrypt salt (base64); null when unlocked
--   lock_hash             text         — scrypt pwhash (base64); null when unlocked
--   faction_id            uuid         — FK to factions(id) if claimed by faction
--   addons_total_cents    int >= 0     — sum of audio + lock + tier surcharge in cents
--   purchase_batch_id     uuid         — groups siblings in a faction block purchase
--
-- All entries are server-controlled (written via Stripe webhook with the
-- service-role key, which bypasses RLS). The browser never reads these
-- column values to learn the unlock passphrase — it always asks the server.
-- =============================================================================

-- ----- Column additions -----
alter table public.tiles
  add column if not exists tier                text,
  add column if not exists audio_chip_id       text,
  add column if not exists lock_kind           text,
  add column if not exists lock_salt           text,
  add column if not exists lock_hash           text,
  add column if not exists faction_id          uuid,
  add column if not exists addons_total_cents  integer not null default 0,
  add column if not exists purchase_batch_id   uuid;

-- ----- Partial indexes (cheap: only index rows that have these set) -----
create index if not exists tiles_tier_idx
  on public.tiles (tier)
  where tier is not null;

create index if not exists tiles_faction_idx
  on public.tiles (faction_id)
  where faction_id is not null;

create index if not exists tiles_batch_idx
  on public.tiles (purchase_batch_id)
  where purchase_batch_id is not null;

create index if not exists tiles_audio_chip_idx
  on public.tiles (audio_chip_id)
  where audio_chip_id is not null;

-- Fast path for unlock endpoint: look up by (id) and get lock fields only.
-- Index on id is already PRIMARY KEY, so no extra index needed.

-- ----- CHECK constraints -----
alter table public.tiles
  drop constraint if exists tiles_tier_check,
  add  constraint tiles_tier_check
       check (tier is null or tier in ('legendary','corner','prime'));

alter table public.tiles
  drop constraint if exists tiles_lock_kind_check,
  add  constraint tiles_lock_kind_check
       check (lock_kind is null or lock_kind in ('passphrase'));

alter table public.tiles
  drop constraint if exists tiles_addons_cents_check,
  add  constraint tiles_addons_cents_check
       check (addons_total_cents >= 0 and addons_total_cents <= 10000);

-- ----- Reasonable length bounds on the new short columns -----
alter table public.tiles
  drop constraint if exists tiles_audio_chip_id_len,
  add  constraint tiles_audio_chip_id_len
       check (audio_chip_id is null or char_length(audio_chip_id) <= 32);

-- ----- Notes -----
-- The `addons_total_cents` column is the server-computed surcharge portion of
-- the tile's price at purchase time. `amount_paid` (added in 0002) is the
-- total Stripe charge. The combination `(amount_paid - addons_total_cents)`
-- reconstructs the base price for analytics / receipts.
--
-- We do NOT add a FK from tiles.faction_id → factions.id here; that's defined
-- in 0005 along with the factions tables themselves.
