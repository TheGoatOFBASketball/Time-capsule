# The Time Capsule Billboard

A minimalist, grid-based landing page where anyone can buy a tiny digital square on a 10,000-tile billboard and leave a short, permanently-timestamped message. Built as a self-contained, no-build-step demo you can open straight from disk.

![preview](https://placehold.co/1200x600/f6f3ec/1a1a1f?text=The+Time+Capsule+Billboard)

## Run it

```bash
# Just open it
open index.html

# Or serve it (recommended, so localStorage behaves normally)
python3 -m http.server 8080
# then visit http://localhost:8080
```

No build step. No package install. No API keys.

## What's in here

```
.
├── index.html   # Markup, fonts, Tailwind via CDN, modal/toast shells
├── styles.css   # Warm-paper × terminal theme tokens, 100×100 grid, modal, ticker
├── script.js    # Tile data, deterministic seed, mock checkout, share, ledger feed
└── README.md    # This file
```

## How it's built

### Stack
- **Pure HTML + vanilla JS + a tiny bit of Tailwind utility CSS via CDN** for fast, dependency-free deployment.
- **CSS Grid** (`grid-template-columns: repeat(100, 1fr)`) renders all 10,000 tiles natively. No canvas, no virtualization — modern browsers handle a 10k-button grid easily.
- **localStorage** persists any tiles a visitor claims, so the experience picks up where it left off across reloads.

### Aesthetic
The "Notion-meets-Terminal" vibe is implemented with:
- **Two-theme token system** (warm cream `#f6f3ec` + rust accent `#b8704a` for light; deep ink `#0e0e12` + warm amber `#d4a574` for dark) — toggle in the nav.
- **Fraunces** serif for editorial headlines, **JetBrains Mono** for the terminal-style data, **Inter** for the body.
- **No drop-shadows, soft 1px rules, dashed dividers, hard 8px corner brackets** on the billboard frame, plus a stat ticker that gently shimmers and a blinking block cursor on the headline.

### Deterministic pre-seed
On first visit, the script seeds ~15% of the grid (`mulberry32` PRNG, fixed seed `0xc0ffee`) with a curated bank of ~130 short human-scale messages — jokes, prayers, emojis, kaomoji, tiny poems. The result is the same "starting board" for every visitor: a believable already-populated archive.

### Tile colorization
Every filled tile gets a color picked from a 48-color warm muted palette via a hash of its message text. The grid ends up looking like a little mosaic — far from a sterile ASCII readout.

### Mock checkout
The "claim → $3 → success" flow is a fully self-contained Stripe parody:
1. Modal opens; user enters a ≤60-char message + optional emoji + optional handle + a "permanent, no edits" acknowledgement.
2. On submit, a faux Stripe payment step animates a progress bar and streams console-style logs (`[stripe] payment succeeded`, `[ledger] writing tile #127`, etc.).
3. On confirm, the tile is written to localStorage, the row is committed to the DOM (with a pulsing color scale-in animation), and the live ledger prepends a new entry.

### Share-to-X
Clicking "share tile #X" copies a deep-link (`#tile-127`) to the clipboard and opens a pre-populated `twitter.com/intent/tweet` window, so anyone can brag about their square.

## What this demo is *not*

| Concept pitch says | This demo does |
|---|---|
| Stripe checkout | Mocked locally with progress + logs |
| Supabase storage | localStorage |
| Persistent public archive | Per-browser (a snapshot per visitor) |
| 100k tiles (Million Dollar Homepage scale) | 10,000 (100×100) — keeping DOM cheap |

## Shared mode (Supabase)

By default the app uses **localStorage** — every visitor sees their own private archive. To make the billboard **shared** (one board for everyone, updates live as anyone in the world claims a tile), back it with Supabase.

```
# 1. Sign up at supabase.com → New project → Project Settings → API
# 2. Paste migrations/0001_init.sql into the SQL editor → Run
# 3. Seed the archive with deterministic rows:
SUPABASE_URL=https://xxx.supabase.co \
SUPABASE_SERVICE_KEY=ey... \
  node supabase/seed.mjs
# 4. Plug in your anon key:
cp config.example.js config.js
$EDITOR config.js   # paste URL + anon key
```

Two tabs in two browsers now see the same board. New claims anywhere in the world appear in every live-ledger tape in real-time.

Full walkthrough — schema, RLS, realtime publication, conflict UX, future Stripe migration — lives in `supabase/README.md`.

### Architecture

```
┌────────────────────────────────┐         ┌─────────────────────┐
│         browser (anon)         │         │      Supabase       │
│                                │         │                     │
│  config.js                     │         │  ┌───────────────┐  │
│    window.__SUPABASE_URL__     │         │  │   tiles       │  │
│    window.__SUPABASE_ANON_KEY__│ ──────▶ │  │  id PK        │  │
│                                │  REST   │  │  x, y, text…  │  │
│  supabase-js                   │ ◀────── │  │  timestamp    │  │
│                                │  WSS    │  └───────────────┘  │
│  • SELECT on load              │ ──────▶ │  RLS: SELECT open   │
│  • INSERT on claim             │         │  RLS: INSERT anon   │
│  • postgres_changes subscribe  │ ◀────── │  + Realtime pub     │
│                                │         │                     │
└────────────────────────────────┘         └─────────────────────┘
```

### Conflict handling

Two users click tile #404 simultaneously. PostgreSQL's PRIMARY KEY on `id` rejects the second INSERT with code `23505`. The losing user sees:

> **Someone beat you to it.**
> Tile #404 was just claimed by someone else — even before your payment cleared. Their inscription now occupies the spot. Your card will not be charged.

…and the realtime feed already has the winner's row, so their tile lights up on the loser's board the moment the modal closes.

### Hardening path (when Stripe wires in)

Flip the RLS INSERT policy from "anon allowed with CHECK" to "service_role only", and route every write through a Supabase Edge Function called by your Stripe webhook. The full migration SQL comment block in `supabase/migrations/0001_init.sql` documents the swap.

## Stripe payments

Real card payments wired through Netlify Functions + Stripe Payment Element + Supabase service-role writes. End-to-end walkthrough — env vars, webhook secret, RLS hardening migration, test cards, refund-on-race — lives in [`STRIPE.md`](./STRIPE.md).

Architecture in one breath:

```
browser POSTs to /.netlify/functions/create-payment-intent
       → server creates Stripe PaymentIntent with metadata {tile_id, text, emoji, handle}
       → returns client_secret
browser confirms card with stripe.confirmPayment()
       → Stripe fires payment_intent.succeeded webhook
       → /.netlify/functions/stripe-webhook verifies HMAC + service-role INSERT into Supabase
       → Supabase realtime broadcast lights up the tile on every connected browser
```

The webhook also auto-refunds the buyer if two users paid for the same tile and the second one's INSERT lost the DB race (PostgreSQL `23505` uniqueness violation → Stripe refund → 200 to Stripe). You never have to refund manually.

## Price

The brief suggested $2–$5. The demo is hardcoded at **$3** (`script.js` `TILE_PRICE_USD`).

## License

Do whatever you want with this. It's a sketch.
