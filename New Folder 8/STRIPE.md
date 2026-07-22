# Wiring real Stripe payments

The "Real" Stripe flow replaces the in-browser mock checkout. After this is wired, claiming a tile goes through:

```
browser → /.netlify/functions/create-payment-intent  (server)
        ← { client_secret }
browser → Stripe Payment Element (card details entered)
        → stripe.confirmPayment() (3DS handled by Stripe if needed)
        → payment_intent.succeeded event fired by Stripe
        → POST /.netlify/functions/stripe-webhook (signature verified)
        → Supabase service-role INSERT tile row  (bypasses RLS)
        → Supabase realtime broadcast → every connected browser updates.
```

Five moving parts. Here's how to set each one up.

---

## 1. Stripe side (10 minutes)

1. Sign up at https://dashboard.stripe.com/register. Free; verification is instant for test mode.
2. From the dashboard, grab the **publishable key** (`pk_test_...`) and the **secret key** (`sk_test_...`) — https://dashboard.stripe.com/apikeys.
3. Click **Webhooks** in the left nav → **Add endpoint**:
   - **Endpoint URL**: `https://<your-netlify-site>.netlify.app/.netlify/functions/stripe-webhook`
   - **Events to send**: `payment_intent.succeeded`
   - Click **Add endpoint**.
4. On the endpoint's detail page, click **Reveal** under "Signing secret". Copy that value (`whsec_...`). Paste into Netlify env as `STRIPE_WEBHOOK_SECRET`.

> Use **Test mode** while developing. Flip to **Live mode** and swap the keys when ready to ship.

## 2. Netlify env vars (2 minutes)

Site settings → Environment variables. Add these four:

| name | value | scope |
|------|-------|-------|
| `SUPABASE_URL` | `https://xxx.supabase.co` | All |
| `SUPABASE_ANON_KEY` | `ey...` (public anon key) | All |
| `SUPABASE_SERVICE_KEY` | `ey...` (service-role) | Functions only |
| `STRIPE_SECRET_KEY` | `sk_test_...` | Functions only |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | Functions only |
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_...` | All (so config.js can read) |

`SUPABASE_SERVICE_KEY`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET` are sensitive — restrict their scope to **Functions** so they cannot leak into the browser bundle.

## 3. Apply the Supabase migrations

In Supabase → SQL editor, run in order:

```sql
-- 0001: schema (you already ran this)
-- 0002: add Stripe columns
-- (paste contents of supabase/migrations/0002_stripe_payments.sql → Run)

-- 0003: harden RLS — run only AFTER you've verified Stripe end-to-end
-- (paste contents of supabase/migrations/0003_harden_rls.sql → Run)
```

**Do run 0003 last.** Before it runs, the demo-phase permissive INSERT policy still lets any browser write a row directly. After it runs, the only path to write a tile is via the Stripe webhook. Re-run `node supabase/seed.mjs` after 0003 if you want; it uses `SUPABASE_SERVICE_KEY` (which bypasses RLS) so it still works.

## 4. Browser config (1 minute)

```bash
cp config.example.js config.js
$EDITOR config.js
```

Paste your Stripe **publishable key** into `window.__STRIPE_PK__`:

```js
window.__STRIPE_PK__ = 'pk_test_xxxxxxxxxxxxxxxxxxxxxxxx';
```

`config.js` is gitignored, so this value never lands in version control.

## 5. Deploy

```bash
git add -A && git commit -m "stripe: real payments wired"
git push
```

Netlify auto-deploys the static site *and* the `netlify/functions/` directory.

## 6. End-to-end test

1. Visit the deployed URL.
2. Click an empty tile → fill in a message → submit.
3. The Stripe Payment Element appears in the modal. Use a [test card](https://docs.stripe.com/testing):
   - `4242 4242 4242 4242` — succeeds
   - `4000 0000 0000 9995` — declined (insufficient funds)
   - Any future expiry, any 3-digit CVC, any postal code.
4. Click **pay $3**. Stripe confirms → your modal shows "etching your inscription…" → ~1 second later the realtime feed brings your tile in and the success modal appears.
5. Verify in:
   - Stripe dashboard → **Payments** (should see a $3.00 entry)
   - Supabase → **Table editor → tiles** (should see your row with `payment_intent_id` filled in)
   - The live ledger on the page (your entry appears at the top)

## 7. (Optional) verify the webhook locally with Stripe CLI

```bash
brew install stripe/stripe-cli/stripe
stripe login
stripe listen --forward-to localhost:8888/.netlify/functions/stripe-webhook
stripe trigger payment_intent.succeeded
```

Run against `netlify dev` (a local Netlify Functions emulator). `netlify dev` reads `.env` automatically.

## 8. Going live

1. Stripe dashboard → toggle **Live mode** (top right).
2. Replace `pk_test_...` / `sk_test_...` / `whsec_...` with their `pk_live_...` / `sk_live_...` / `whsec_...` counterparts in Netlify env + config.js.
3. Add a new webhook endpoint under **Live** with the same URL and the same event.
4. Test once with a real card in real mode before announcing anything.

---

## Failure modes & safety nets

| Symptom | Cause | What we do |
|---|---|---|
| User pays, tile takes ages to appear in archive | Stripe webhook retries because signature verification or DB insert is failing | Once we hit a 5xx threshold, Stripe retries every few hours. Function logs land in Netlify → Functions → `stripe-webhook` → Logs. |
| Two users pay for tile #404 at the same time | Both intents succeed; one webhook wins the DB race | The losing webhook detects PG `23505`, issues an automatic refund of the second payment. |
| User's card declined | Bank said no | Stripe.confirmPayment returns an error → shown in the modal inline. No DB write, no charge. |
| Stripe is down | Stripe.com returns 5xx | Our `create-payment-intent` returns 502; we surface "payment service unreachable" to the user. |
| Webhook secret rotates | You regenerated it in Stripe dashboard | Replace `STRIPE_WEBHOOK_SECRET` in Netlify env. Until you do, every webhook gets a 400 from the function (signature mismatch). |
| User pays, closes browser before seeing success | Realtime never delivers the broadcast (network) | Next time they load the page, init() fetches the tile from Supabase → their archive includes it. |

---

## What the webhook handler does (in detail)

```js
// stripe-webhook.js — abbreviated
1. Verify HMAC signature against STRIPE_WEBHOOK_SECRET.
   → If invalid: 400. (Forged events can't write tiles.)
2. Parse the event; ignore anything that isn't payment_intent.succeeded.
3. Read metadata.tile_id / text / emoji / handle from the intent.
4. POST to Supabase REST with service-role key + tile row + payment_intent_id.
   → If 200: done.
   → If 409 with code 23505: another payment beat us to this tile.
     → Issue a refund of THIS payment so the buyer isn't charged.
     → Return 200 to Stripe.
   → If any other 4xx/5xx: return 500 so Stripe retries.
```

The 23505 → refund path is the key safety net. Without it, two simultaneous buyers would each have their cards charged but only one would actually own the tile.

---

## Files in this implementation

```
netlify/functions/
├── create-payment-intent.js     server-only, called by browser, creates Stripe intent
└── stripe-webhook.js            server-only, called by Stripe, writes tile + handles refund
supabase/migrations/
├── 0001_init.sql                schema + RLS (demo-phase permissive INSERT)
├── 0002_stripe_payments.sql     add payment_intent_id + amount_paid columns
└── 0003_harden_rls.sql          drop permissive INSERT; deny all client inserts
```

The browser code (`script.js`, `config.example.js`, `index.html`, `netlify.toml`) keys off the literal `__STRIPE_PK__` value — present means real Stripe, absent means the in-browser mock.
