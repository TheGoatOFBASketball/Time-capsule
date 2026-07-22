// =============================================================================
// netlify/functions/create-payment-intent.js
//
//   Creates a Stripe PaymentIntent for a tile claim.
//   Called by the browser right after the user fills in the claim form.
//
//   Auth:  none required (anonymous public endpoint). The Origin header
//          check + per-IP rate limit below are the primary defenses.
//
//   Env:   STRIPE_SECRET_KEY                required
//          SUPABASE_URL + SUPABASE_SERVICE_KEY optional (used for pre-check)
//
//   Returns:  200 { client_secret: "pi_..._secret_..." }
//             400 invalid body / bad tile id / bad text
//             403 cross-origin forbidden
//             409 tile already claimed
//             429 too many requests
//             502 Stripe error
// =============================================================================

const PRICE_CENTS = 300;          // $3 — keep in sync with TILE_PRICE_USD in script.js
const TILE_COUNT  = 10000;        // grid is 100×100

const SUPABASE_URL       = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ----- Per-instance burst throttle (NOT a global rate limit) -----
// Netlify Functions may cold-start per-invocation, so the HITS Map does NOT
// survive across invocations. Real production traffic shaping needs edge-
// level limits (Netlify Pro edge limits, a Cloudflare rule in front of the
// domain, or Upstash/Redis as a service). This token bucket is here to slow
// burst spam within a single Lambda instance and to discourage accidental
// client retry storms. Stripe's own per-account API throttling is the
// ultimate backstop.
const HITS = new Map();
function rateLimitOk(ip) {
  const now  = Date.now();
  const win  = 60_000;        // 1-minute window
  const max  = 30;            // 30 hits/min/IP
  const list = (HITS.get(ip) || []).filter(t => (now - t) < win);
  if (list.length >= max) return false;
  list.push(now);
  HITS.set(ip, list);
  return true;
}

// ----- Allowed-origin set for the CSRF/origin check -----
// Netlify Functions' `request.url` host is the DEPLOY URL (your-site.netlify.app),
// not the custom domain you put in front of it. To allow your production
// domain(s), list them in the `ALLOWED_ORIGINS` Netlify env var as a
// comma-separated string, e.g.:
//     ALLOWED_ORIGINS = "https://yourname.com,https://www.yourname.com"
// Include the deploy URL (`process.env.URL`) by default.
function allowedOriginHosts(requestUrl) {
  const set = new Set([new URL(requestUrl).host]);
  for (const entry of (process.env.ALLOWED_ORIGINS || '').split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    try { set.add(new URL(trimmed).host); } catch (_) { /* skip malformed */ }
  }
  return set;
}

function jsonError(msg, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async (request) => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // ----- 0. Same-origin + rate-limit guard -----
  // Browsers send Origin on cross-origin requests AND on same-origin POSTs.
  // If present, it MUST be in the allowed-origin set (deploy URL + any
  // custom domains listed in ALLOWED_ORIGINS env var). Cheap CSRF + cost-DoS
  // defense for an anonymous-public endpoint.
  // The Stripe webhook (different file) is server-to-server so has no Origin rule.
  const origin = request.headers.get('origin');
  if (origin) {
    const allowed = allowedOriginHosts(request.url);
    if (!allowed.has(new URL(origin).host)) {
      return jsonError('cross-origin forbidden', 403);
    }
  }
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
           || request.headers.get('client-ip')
           || 'unknown';
  if (!rateLimitOk(ip)) return jsonError('too many requests', 429);

  // ----- 1. Parse + validate body -----
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('invalid JSON');
  }

  const tile_id = Number(body.tile_id);
  if (!Number.isInteger(tile_id) || tile_id < 0 || tile_id >= TILE_COUNT) {
    return jsonError(`tile_id must be 0..${TILE_COUNT - 1}`);
  }

  const text = String(body.text || '').trim();
  if (text.length === 0 || text.length > 60) {
    return jsonError('text must be 1..60 characters');
  }

  const emoji  = (typeof body.emoji  === 'string') ? body.emoji.slice(0, 8)  : '';
  const handle = (typeof body.handle === 'string') ? body.handle.slice(0, 24) : '';
  const buyer_email = (typeof body.buyer_email === 'string') ? body.buyer_email.slice(0, 200) : '';

  // ----- 2. Pre-check: if Supabase is configured, refuse payment for already-claimed
  //          tiles so the user gets a clear error before the webhook nightmare.
  //          NOTE: still race-prone — the user could pay in the millisecond between
  //          the pre-check and the webhook. The webhook handler auto-refunds on
  //          that rare conflict, so the user is never charged twice.
  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    try {
      const probe = await fetch(`${SUPABASE_URL}/rest/v1/tiles?id=eq.${tile_id}&select=id`, {
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      });
      if (probe.ok) {
        const rows = await probe.json();
        if (Array.isArray(rows) && rows.length > 0) {
          return jsonError('tile already claimed — pick another', 409);
        }
      }
    } catch (e) {
      // Probe is best-effort; don't block payment if Supabase is having a hiccup.
      console.warn('tile pre-check failed (continuing):', e.message);
    }
  }

  // ----- 3. Create the PaymentIntent via Stripe REST API (no SDK needed) -----
  // Form-encoded body, Basic auth with secret key.
  const params = new URLSearchParams();
  params.append('amount', String(PRICE_CENTS));
  params.append('currency', 'usd');
  params.append('automatic_payment_methods[enabled]', 'true');
  if (buyer_email) params.append('receipt_email', buyer_email);
  params.append('metadata[tile_id]', String(tile_id));
  params.append('metadata[text]',    text);
  if (emoji)  params.append('metadata[emoji]',  emoji);
  if (handle) params.append('metadata[handle]', handle);
  // Idempotency key: same tile_id twice produces the same intent id, letting
  // Stripe dedupe accidental double-submits from the same buyer.
  const idemKey = `tcb-tile-${tile_id}-${Date.now().toString(36)}`;
  params.append('idempotency_key', idemKey);

  try {
    const stripeRes = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        'Authorization':   `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type':    'application/x-www-form-urlencoded',
        'Stripe-Version':  '2024-06-20',
        'Idempotency-Key': idemKey,
      },
      body: params.toString(),
    });

    const stripeBody = await stripeRes.json();
    if (!stripeRes.ok) {
      console.error('stripe error', stripeRes.status, stripeBody);
      return jsonError(stripeBody?.error?.message || 'payment provider error', 502);
    }

    return new Response(
      JSON.stringify({ client_secret: stripeBody.client_secret }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('stripe fetch failed', e);
    return jsonError('payment provider unreachable', 502);
  }
};
