// =============================================================================
// netlify/functions/unlock-tile.js
//
//   Server-side passphrase check for locked tiles (Bury a Secret).
//
//   The tile's `text`, `emoji`, `handle` are NEVER sent over the wire until
//   the user supplies the correct passphrase. The browser calls this
//   endpoint when a visitor clicks a tile with `lock_kind='passphrase'`.
//   The endpoint returns 200 + the message on a match, 403 otherwise.
//
//   Auth: rate-limited by (ip + tile_id) in-memory.
//   Env:  SUPABASE_URL + SUPABASE_SERVICE_KEY (read-only lookup; service-role
//         key never leaves the server).
//
//   Returns:  200 { ok: true, text, emoji, handle, timestamp, id }
//             403 { error: 'wrong passphrase' }
//             404 { error: 'tile not found' }    (also when tile is unlocked
//                                                 — visiting a public tile
//                                                 must NOT show its password)
//             429 too many requests
// =============================================================================

import process from 'node:process';

// ----- Per-instance burst throttle (NOT a global rate limit). Same posture
//       as create-payment-intent: a small in-Lambda HITS map. Real ceilings
//       live in front of the domain (Netlify/Cloudflare). -----
const HITS = new Map();
function rateLimitOk(key, maxPerMinute = 10) {
  const now  = Date.now();
  const win  = 60_000;
  const list = (HITS.get(key) || []).filter(t => (now - t) < win);
  if (list.length >= maxPerMinute) return false;
  list.push(now);
  HITS.set(key, list);
  return true;
}

function jsonError(msg, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function okJson(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async (request) => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Passphrase endpoint is strictly POST with JSON body. We don't check
  // Origin because the click is from OUR own page; CSRF isn't a concern.

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
           || request.headers.get('client-ip')
           || 'unknown';

  let body;
  try { body = await request.json(); }
  catch { return jsonError('invalid JSON'); }

  const tileId = Number(body.tile_id);
  if (!Number.isInteger(tileId) || tileId < 0 || tileId >= 10000) {
    return jsonError('bad tile_id');
  }

  const passphrase = String(body.passphrase ?? '');
  if (passphrase.length === 0 || passphrase.length > 200) {
    return jsonError('passphrase must be 1..200 characters');
  }

  if (!rateLimitOk(`unlock:${ip}:${tileId}`, 10)) {
    return jsonError('too many attempts; try again in a minute', 429);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const key         = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !key) {
    return jsonError('server config missing', 500);
  }

  // Dynamic import of scrypt-helper so cold starts don't pay for it on
  // unrelated paths.
  const { verifyPassphrase } = await import('./lib/scrypt-hash.js');

  // Look up only what we need. We do NOT want a payload that includes the
  // text leaking via some other column read.
  const probe = await fetch(
    `${supabaseUrl}/rest/v1/tiles?` +
      `id=eq.${tileId}` +
      `&select=id,text,emoji,handle,timestamp,lock_kind,lock_salt,lock_hash`,
    {
      headers: {
        'apikey':        key,
        'Authorization': `Bearer ${key}`,
      },
    }
  );
  if (!probe.ok) {
    return jsonError(`lookup failed (${probe.status})`, 502);
  }
  const rows = await probe.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    // Don't leak existence — but a non-existent tile is harmless here.
    return jsonError('tile not found', 404);
  }
  const row = rows[0];

  if (row.lock_kind !== 'passphrase' || !row.lock_salt || !row.lock_hash) {
    // Tile isn't locked or hash fields were cleared: treat as "wrong" so
    // nobody can probe via this endpoint for unlocked content paths.
    return jsonError('wrong passphrase', 403);
  }

  const matches = await verifyPassphrase(passphrase, row.lock_salt, row.lock_hash);
  if (!matches) {
    // Same error shape on every wrong attempt — no oracle for whether the
    // hash format is right or whether the salt exists.
    return jsonError('wrong passphrase', 403);
  }

  return okJson({
    ok: true,
    id: row.id,
    text: row.text,
    emoji: row.emoji || '',
    handle: row.handle || null,
    timestamp: row.timestamp,
  });
};
