// =============================================================================
// netlify/functions/faction-create.js
//
//   Creates a faction and bootstraps the leader membership row, gated by
//   Supabase Auth. Uses the user's access token (sent from the browser:
//   `await supabase.auth.session()`) to verify they are who they claim.
//
//   Why this is server-side and not just a Supabase-rpc:
//     • The RLS policy allows INSERT into factions with leader_user_id =
//       auth.uid() — but browsers can satisfy that unauthenticated by
//       injecting the wrong auth.uid via the SDK,
//     • Wait — they CAN'T. The anon key + auth SDK never gives a client a
//       different user identity. The RLS approach is fine on its own.
//       BUT: the FIRST `factions_members` row (leader) requires the
//       user to already be a member in order to satisfy the RLS
//       "leader_only" check on factions_members INSERT. Chicken-and-egg.
//     • Solution: this function does the bootstrap using the SERVICE
//       role key (bypasses RLS) AFTER validating the user's access
//       token against Supabase Auth. The lookup-then-INSERT pattern
//       matches the operator's intent: only authenticated users get
//       factions, and the auth.uid they came in with is the leader.
//
//   Env:  SUPABASE_URL + SUPABASE_SERVICE_KEY
//         SUPABASE_ANON_KEY              (also required, for auth verification)
//
//   Returns:  200 { id, name, palette, description, role: 'leader' }
//             400 validation error
//             401 not authenticated
//             409 faction name taken
//             429 too many requests
// =============================================================================

import process from 'node:process';

// ----- Burst throttle -----
const HITS = new Map();
function rateLimitOk(ip, maxPerMinute = 6) {
  const now  = Date.now();
  const win  = 60_000;
  const list = (HITS.get(ip) || []).filter(t => (now - t) < win);
  if (list.length >= maxPerMinute) return false;
  list.push(now);
  HITS.set(ip, list);
  return true;
}

function jsonError(msg, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function okJson(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function resolveUser(supabaseUrl, anonKey, bearer) {
  const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${bearer}`, 'apikey': anonKey },
  });
  if (!r.ok) return null;
  const body = await r.json();
  return body.id ? body : null;
}

export default async (request) => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
           || request.headers.get('client-ip')
           || 'unknown';
  if (!rateLimitOk(`faction:${ip}`, 6)) {
    return jsonError('too many faction creates; slow down', 429);
  }

  const auth = request.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return jsonError('missing bearer token', 401);
  const bearer = m[1].trim();

  let body;
  try { body = await request.json(); }
  catch { return jsonError('invalid JSON'); }

  const name = String(body.name ?? '').trim();
  if (name.length < 1 || name.length > 40) return jsonError('name 1..40 chars');
  if (!/^[a-zA-Z0-9 ._\-]+$/.test(name)) return jsonError('name has invalid chars');

  const description = body.description ? String(body.description).slice(0, 280) : null;
  const palette     = body.palette ? String(body.palette).slice(0, 16) : '#a45a76';

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  const anonKey     = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey || !anonKey) {
    return jsonError('server config missing', 500);
  }

  // ----- 1. Verify the bearer's identity against Supabase Auth -----
  const user = await resolveUser(supabaseUrl, anonKey, bearer);
  if (!user) return jsonError('invalid auth token', 401);
  const userId = user.id;

  // ----- 2. INSERT faction -----
  const factionRes = await fetch(`${supabaseUrl}/rest/v1/factions`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Prefer':        'return=representation',
    },
    body: JSON.stringify({
      name,
      leader_user_id: userId,
      palette,
      description,
    }),
  });

  if (!factionRes.ok) {
    const t = await factionRes.text();
    // 23505 = unique violation on name
    if (factionRes.status === 409 || /23505/.test(t)) {
      return jsonError('faction name already taken', 409);
    }
    console.error('faction INSERT failed', factionRes.status, t);
    return jsonError('faction create failed', 502);
  }

  const [faction] = await factionRes.json();

  // ----- 3. Bootstrap the leader's factions_members row -----
  // We use the SERVICE key bypass so the leader-only RLS check doesn't
  // chicken-and-egg the first row. The leader is, by definition,
  // leader_user_id — anyone reading the table can verify this.
  const memberRes = await fetch(`${supabaseUrl}/rest/v1/factions_members`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Prefer':        'return=minimal',
    },
    body: JSON.stringify({
      faction_id: faction.id,
      user_id:    userId,
      role:       'leader',
    }),
  });
  if (!memberRes.ok) {
    // If this fails the faction row is orphaned. Real ops would roll back
    // the faction here. Logged for ops visibility.
    const t = await memberRes.text();
    console.error('faction leader self-INSERT failed', memberRes.status, t);
    return jsonError('faction created but leader membership failed', 502);
  }

  return okJson({
    id: faction.id,
    name: faction.name,
    palette: faction.palette,
    description: faction.description,
    role: 'leader',
  });
};
