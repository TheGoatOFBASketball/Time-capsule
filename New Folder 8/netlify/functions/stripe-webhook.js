// =============================================================================
// netlify/functions/stripe-webhook.js
//
//   Handles Stripe webhooks. The only event we care about is
//   `payment_intent.succeeded`. On that event we:
//     1) verify the HMAC signature against STRIPE_WEBHOOK_SECRET,
//     2) read metadata {tile_id, text, emoji, handle} from the intent,
//     3) INSERT a row into public.tiles via the Supabase service-role key
//        (which bypasses RLS — that's the only path writes go through),
//     4) return 200 to Stripe so it stops retrying.
//
//   On UNIQUE-violation (tile already taken by a *different* concurrent
//   payment that beat this one to the DB) we issue a refund so the buyer
//   isn't charged for a tile they can't have.
//
//   No npm dependencies — pure node:crypto + fetch.
//
//   Env:
//     STRIPE_SECRET_KEY       required (server-side calls)
//     STRIPE_WEBHOOK_SECRET   required (HMAC verification)
//     SUPABASE_URL            required
//     SUPABASE_SERVICE_KEY    required (bypasses RLS)
//
//   Configure the endpoint in the Stripe dashboard:
//     https://dashboard.stripe.com/webhooks → Add endpoint
//     URL: https://<your-site>.netlify.app/.netlify/functions/stripe-webhook
//     Events: payment_intent.succeeded
//   Then copy the "Signing secret" into Netlify env as STRIPE_WEBHOOK_SECRET.
// =============================================================================

import crypto from 'node:crypto';
import process from 'node:process';

// ----- 1. Stripe HMAC signature verification -----
//
// Stripe sends:   Stripe-Signature: t=1700000000,v1=abc123...
// We compute:     HMAC-SHA256(t + "." + raw_body, secret)
// and timing-safe-compare against v1. Tolerance: 5 minutes.
function verifyStripeSignature(rawBody, sigHeader, secret, tolerance = 300) {
  if (!sigHeader || !secret) return false;

  let ts, v1;
  for (const entry of sigHeader.split(',')) {
    const i = entry.indexOf('=');
    if (i < 0) continue;
    const k = entry.slice(0, i).trim();
    const v = entry.slice(i + 1).trim();
    if (k === 't') ts = v;
    if (k === 'v1') v1 = v;
  }
  if (!ts || !v1) return false;

  const elapsed = Math.abs(Math.floor(Date.now() / 1000) - Number(ts));
  if (!Number.isFinite(elapsed) || elapsed > tolerance) return false;

  const signedPayload = `${ts}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(v1, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ----- 2. Refund helper -----
async function refundPayment(stripeSecret, paymentIntentId, reason) {
  const params = new URLSearchParams();
  params.append('payment_intent', paymentIntentId);
  params.append('reason', reason || 'requested_by_customer');
  params.append('metadata[automation]', 'tcb-webhook');
  try {
    const res = await fetch('https://api.stripe.com/v1/refunds', {
      method: 'POST',
      headers: {
        'Authorization':  `Bearer ${stripeSecret}`,
        'Content-Type':   'application/x-www-form-urlencoded',
        'Stripe-Version': '2024-06-20',
        'Idempotency-Key': `tcb-refund-${paymentIntentId}`,
      },
      body: params.toString(),
    });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
  } catch (e) {
    return { ok: false, status: 0, body: { error: e.message } };
  }
}

// ----- 3. Supabase probe helpers (service-role, bypasses RLS) -----
//
// Read-only GETs let us disambiguate 4 idempotency states before we attempt an
// INSERT. Without these, we'd need to "ignore duplicates" silently — which
// makes us miss the legitimate case where two buyers paid for the same tile
// and the second one needs a refund.

async function probeTileByPaymentIntent(supabaseUrl, supabaseKey, paymentIntentId) {
  // Did we already process THIS Stripe payment (i.e. is Stripe retrying)?
  const res = await fetch(
    `${supabaseUrl}/rest/v1/tiles?payment_intent_id=eq.${encodeURIComponent(paymentIntentId)}&select=id`,
    { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function probeTileById(supabaseUrl, supabaseKey, tileId) {
  // Is this tile already claimed (potentially by a DIFFERENT payment)?
  const res = await fetch(
    `${supabaseUrl}/rest/v1/tiles?id=eq.${tileId}&select=id,payment_intent_id`,
    { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

// ----- 4. Supabase tile INSERT (service-role, bypasses RLS) -----
//
// Intentionally NOT using `Prefer: resolution=ignore-duplicates` — we want a
// 409 to surface so we can refund racing payments. Idempotency against
// Stripe-retry is handled earlier by probeTileByPaymentIntent().

async function insertTile(supabaseUrl, supabaseKey, row) {
  const res = await fetch(`${supabaseUrl}/rest/v1/tiles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey':        supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Prefer':        'return=minimal',
    },
    body: JSON.stringify(row),
  });
  const text   = await res.text();
  let   parsed = null;
  try { parsed = JSON.parse(text); } catch (_) { /* empty body is fine */ }
  return { status: res.status, ok: res.ok, body: parsed };
}

// =============================================================================

export default async (request) => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const sig  = request.headers.get('stripe-signature');
  const body = await request.text();   // MUST read raw body for HMAC verification

  if (!verifyStripeSignature(body, sig, process.env.STRIPE_WEBHOOK_SECRET)) {
    return new Response('signature verification failed', { status: 400 });
  }

  let event;
  try { event = JSON.parse(body); }
  catch { return new Response('invalid JSON', { status: 400 }); }

  // Acknowledge every other event type without acting. Stripe retries non-2xx,
  // so we MUST return 200 to prevent runaway retries.
  if (event.type !== 'payment_intent.succeeded') {
    return new Response('ignored', { status: 200 });
  }

  const intent      = event.data.object;
  const metadata    = intent.metadata || {};
  const tileIdNum   = Number(metadata.tile_id);
  if (!Number.isInteger(tileIdNum) || tileIdNum < 0 || tileIdNum >= 10000) {
    console.error('webhook: bad tile_id metadata', metadata);
    return new Response('bad metadata', { status: 400 });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  const stripeKey   = process.env.STRIPE_SECRET_KEY;

  // --- (a) Has Stripe retried THIS exact payment before? ---
  const existing = await probeTileByPaymentIntent(supabaseUrl, supabaseKey, intent.id);
  if (existing) {
    console.log(`webhook: ${intent.id} already processed, ack silently`);
    return new Response('already processed', { status: 200 });
  }

  // --- (b) Has this tile been claimed by a DIFFERENT payment already? ---
  const tileTaken = await probeTileById(supabaseUrl, supabaseKey, tileIdNum);
  if (tileTaken) {
    console.warn(`race: tile ${tileIdNum} taken by ${tileTaken.payment_intent_id}, refunding ${intent.id}`);
    const refund = await refundPayment(stripeKey, intent.id, 'requested_by_customer');
    if (refund.ok) {
      console.log(`refund ${refund.body.id} issued for ${intent.id}`);
      return new Response('ok (refunded on race)', { status: 200 });
    }
    // Refund failed — return 500 so Stripe retries the webhook. The probe-(a)
    // check on retry is keyed on `payment_intent_id`, so on retry we'll re-enter
    // this branch (the existing tile row carries a *different* payment_intent_id)
    // and try the refund again. Without this ack-on-failure we'd lock the
    // user out of getting their money back.
    console.error('refund failed — returning 500 so Stripe retries', refund.status, refund.body);
    return new Response('refund failed, retry', { status: 500 });
  }

  // --- (c) Insert the row. If a *concurrent* webhook beat us here (race that
  //         happened between probeTileById and insertTile), we DO get a real
  //         23505 and the refund branch below catches it. ---
  const row = {
    id:                tileIdNum,
    x:                 tileIdNum % 100,
    y:                 Math.floor(tileIdNum / 100),
    text:              String(metadata.text    || '').slice(0, 60),
    emoji:             metadata.emoji ? String(metadata.emoji).slice(0, 8) : null,
    handle:            metadata.handle ? String(metadata.handle).slice(0, 24) : null,
    payment_intent_id: intent.id,
    amount_paid:       intent.amount_received,        // cents
    timestamp:         new Date().toISOString(),
    created_at:        new Date().toISOString(),
  };

  const result = await insertTile(supabaseUrl, supabaseKey, row);
  if (result.ok) return new Response('ok', { status: 200 });

  // 23505 here = concurrent genuine race that beat our pre-check. Refund.
  if (result.status === 409 && result.body?.code === '23505') {
    console.warn(`race on insert: tile ${tileIdNum}, refunding ${intent.id}`);
    const refund = await refundPayment(stripeKey, intent.id, 'requested_by_customer');
    if (refund.ok) {
      console.log(`refund ${refund.body.id} issued for ${intent.id}`);
      return new Response('ok (refunded on race)', { status: 200 });
    }
    // Same retry-safe semantics as the (b) branch above.
    console.error('refund failed on insert-race — returning 500 so Stripe retries', refund.status, refund.body);
    return new Response('refund failed, retry', { status: 500 });
  }

  // Anything else: log + return 500 so Stripe retries.
  console.error('db insert failed', result.status, result.body);
  return new Response('db error', { status: 500 });
};
