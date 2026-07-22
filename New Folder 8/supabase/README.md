# Sharing the billboard with Supabase

By default the app uses **localStorage**, so every visitor sees their own private archive. To make the billboard **shared** — every visitor sees the same board, new claims broadcast live — back it with Supabase.

This folder contains everything you need to set that up.

## TL;DR

```bash
# 0. Sign up at supabase.com → New project → save the URL + service_role key
# 1. Run the migration SQL in Supabase → SQL editor
# 2. Seed it with deterministic rows (optional but recommended):
SUPABASE_URL=https://xxx.supabase.co \
SUPABASE_SERVICE_KEY=ey... \
  node supabase/seed.mjs

# 3. Copy config.example.js → config.js, fill in URL + anon key
cp config.example.js config.js
$EDITOR config.js   # paste values
```

The page now reads from Supabase. Two tabs in two browsers will see the same board; new claims appear in every ledger in real-time.

---

## Setup walkthrough

### 1. Create the Supabase project

1. Sign up at https://supabase.com (free tier is plenty).
2. Click **New project** → name it `time-capsule-billboard` → choose a region close to your visitors → wait for provisioning (~1 min).
3. From **Project Settings → API**, copy:
   - **Project URL** (looks like `https://abcdefg.supabase.co`)
   - **anon public key** (long JWT starting with `ey...`)
   - **service_role secret key** (longer JWT, marked "secret" — keep this server-side only).

### 2. Run the migration

Open **SQL Editor** → **New query**. Paste the contents of `migrations/0001_init.sql`, click **Run**.

This creates:
- `public.tiles` table with integer PK on `id` (race-condition guard)
- Indexes on `timestamp` for live-ledger feed
- RLS: anon SELECT enabled, anon INSERT allowed (with strict CHECK), no UPDATE/DELETE
- Realtime publication of the table

### 3. Seed the archive (optional but recommended)

A fresh database is empty. You have two options:

#### Option A — Run the seed script (recommended for cleanest state)

```bash
SUPABASE_URL=https://xxx.supabase.co \
SUPABASE_SERVICE_KEY=ey... \
  node supabase/seed.mjs
```

This writes ~1,500 deterministic seeded tiles using `service_role` (bypasses RLS, safe because the PRNG output is deterministic across runs). The resulting archive matches what the localStorage version would have shown.

Idempotent: re-running won't duplicate rows (uses `onConflict=id, ignore-duplicates`).

#### Option B — Skip seeding

Leave the database empty. The first visitor to land will see a blank board until a few people claim tiles. (Not recommended — you'll lose the "feels populated" first-load UX.)

### 4. Wire the frontend

```bash
# at the project root
cp config.example.js config.js
$EDITOR config.js
```

Replace the placeholder values:

```js
window.__SUPABASE_URL__     = 'https://abcdefg.supabase.co';
window.__SUPABASE_ANON_KEY__ = 'ey...long-jwt...';
```

That's it. The page now:
- Fetches all tiles from Supabase on load
- Subscribes to realtime `INSERT` events on the `tiles` table
- Lives at the same URL; one source of truth for every visitor

### 5. Deploy

If you're on Netlify, just `git add config.js && git commit && git push`. The deploy happens automatically.

If you don't want the URL / key in the repo, paste them as **environment variables** in Netlify (Site settings → Environment variables) and inject via a build plugin — but for a static site without a build step, simple `config.js` is fine. **Do** make sure `config.js` is in your `.gitignore` if you ever push to a public repo.

---

## What the realtime subscription does

After load, the client subscribes to:

```js
supabase.channel('public:tiles')
  .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'tiles' },
      payload => addToBoard(payload.new))
  .subscribe();
```

Every INSERT anywhere in the world (you, a stranger in Tokyo, your mom) instantly fires on every connected client. The board updates, the live ledger tape prepends a new entry, the "archive · shared · realtime" indicator pulses.

The connection is a WebSocket to `wss://*.supabase.co` (handled by `connect-src` in your CSP, see `netlify.toml`).

---

## RLS posture (and how to harden it later)

The current migration lets anon INSERT — necessary for the demo to work without Stripe set up. The CHECK constraints:

| constraint | bound |
|---|---|
| `id` | `0 ≤ id ≤ 9999` |
| `x`, `y` | `0 ≤ x,y ≤ 99` |
| `text` | `1 ≤ length ≤ 60` |
| `emoji` | `length ≤ 8` |
| `handle` | `length ≤ 24` |

That's the minimum a browser can guarantee without server-side validation.

**When you wire real Stripe**, switch this:

```sql
drop policy "tiles_insert_for_anon" on public.tiles;
create policy "tiles_no_insert"
  on public.tiles for insert
  to anon using (false);
```

…and route every write through a Supabase Edge Function called only by your Stripe webhook (using `service_role`). The Stripe webhook handler never trusts the client payload — it re-creates the tile row server-side from the `payment_intent.metadata` after `payment_intent.succeeded` fires.

---

## Files in this folder

| file | purpose |
|---|---|
| `migrations/0001_init.sql` | Schema, indexes, RLS, realtime — run once in SQL editor |
| `seed.mjs` | Optional admin task to populate the archive with deterministic rows |
| `README.md` | This file |

`config.js` (the runtime config) lives at the **repo root**, sibling to `script.js` — and is gitignored.
