/* ================================================
   THE TIME CAPSULE BILLBOARD — script.js
   ================================================
   v2 features added (sharing backend with PRs from this work):
     • Prime real-estate tier preview + glow (legendary / corner / prime)
     • Audio chip add-on (8 hardcoded 8-bit oscillator presets)
     • Fossilization animation on commit (CSS-driven; respects reduced-motion)
     • Bury a Secret passphrase lock + unlock endpoint
     • Faction mode scaffolding (magic-link auth; UI is minimal v1)
   ================================================ */
'use strict';

/* ---------- Constants ---------- */
const TILE_PRICE_USD = 3;
const GRID_SIZE = 100;
const TOTAL_TILES = GRID_SIZE * GRID_SIZE;
const SEED_PERCENT = 0.15;            // ~15% pre-filled on first load
const MAX_MESSAGE_CHARS = 60;
const MAX_HANDLE_CHARS = 24;
const STORAGE_KEY = 'tcb.tiles.v1';

/* ---------- Prime real-estate tier pricing (server is authoritative) ---------- */
// Mirrors netlify/functions/lib/pricing.js — keep in sync.
const TIER_COSTS_CENTS = { legendary: 150, corner: 75, prime: 30, common: 0 };
const BASE_CENTS = 300;
const AUDIO_ADDON_CENTS = 100;        // +$1.00
const LOCK_ADDON_CENTS  =   0;        // free; flag-only
const LEGENDARY_COORDS = new Set(['69,69','69,42','04,20','42,42','50,50']);
const CORNER_COORDS    = new Set(['00,00','00,99','99,00','99,99']);
function pricingTier(x, y) {
  const k = `${String(x).padStart(2,'0')},${String(y).padStart(2,'0')}`;
  if (LEGENDARY_COORDS.has(k)) return 'legendary';
  if (CORNER_COORDS.has(k))    return 'corner';
  if (Math.abs(x - 50) + Math.abs(y - 50) < 10) return 'prime';
  return null;
}
function tilePriceCents(x, y, opts = {}) {
  const tier = pricingTier(x, y);
  const tierCents  = TIER_COSTS_CENTS[tier || 'common'];
  const audioCents = opts.audio_chip_id ? AUDIO_ADDON_CENTS : 0;
  const lockCents  = opts.lock_passphrase ? LOCK_ADDON_CENTS : 0;
  return {
    base: BASE_CENTS + tierCents,    // base price after tier multiplier (surcharge already in tierCents)
    surcharge: tierCents,
    audio: audioCents,
    lock: lockCents,
    total: BASE_CENTS + tierCents + audioCents + lockCents,
    tier,
  };
}
function formatUsdCents(c) { return '$' + (c / 100).toFixed(2); }

/* ---------- Audio chip catalog (8 hardcoded 8-bit oscillator presets) ---------- */
const AUDIO_CHIP_CATALOG = [
  { id: 'mario-coin',   name: 'Mario coin' },
  { id: 'zelda-secret', name: 'Zelda secret' },
  { id: 'tetris-clear', name: 'Tetris clear' },
  { id: 'pacman-dot',   name: 'Pacman dot' },
  { id: 'xp-ding',      name: 'Windows XP ding' },
  { id: 'doom-pickup',  name: 'Doom pickup' },
  { id: 'coin-collect', name: 'Coin collect' },
  { id: 'level-up',     name: '8-bit level up' },
];

// Note→frequency map (slight German notation H for B natural in some presets).
const NOTE_FREQ = {
  C4:261.63, D4:293.66, E4:329.63, F4:349.23, G4:392.00, A4:440.00, B4:493.88, H4:493.88,
  C5:523.25, D5:587.33, E5:659.25, F5:698.46, G5:783.99, A5:880.00, B5:987.77,
  C6:1046.50, D6:1174.66, E6:1318.51, F6:1396.91, F#5:739.99,
};
const CHIP_SEQUENCE = {
  'mario-coin':   [['B5', 0.10], ['E6', 0.18]],
  'zelda-secret': [['G4', 0.11], ['D4', 0.09], ['G4', 0.16]],
  'tetris-clear': [['E5', 0.08], ['H4', 0.04], ['E5', 0.08], ['H4', 0.04], ['E5', 0.08], ['H4', 0.04], ['E5', 0.16], ['C5', 0.08], ['D5', 0.08], ['E5', 0.16]],
  'pacman-dot':   [['B4', 0.06], ['E5', 0.06], ['A5', 0.10]],
  'xp-ding':      [['A4', 0.16], ['D5', 0.16], ['F#5', 0.16], ['A5', 0.32]],
  'doom-pickup':  [['E4', 0.10], ['G4', 0.10], ['B4', 0.16]],
  'coin-collect': [['A4', 0.07], ['C5', 0.07], ['E5', 0.16]],
  'level-up':     [['C4', 0.10], ['E4', 0.10], ['G4', 0.10], ['C5', 0.16]],
};

function playChip(chipId) {
  const seq = CHIP_SEQUENCE[chipId];
  if (!seq) return;
  try {
    const ac = window.__audioCtx
            || (window.__audioCtx = new (window.AudioContext || window.webkitAudioContext)());
    let t = ac.currentTime + 0.005;
    for (const [note, dur] of seq) {
      const osc = ac.createOscillator();
      osc.type = 'square';
      osc.frequency.value = NOTE_FREQ[note] || 440;
      const g = ac.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.01);
      g.gain.linearRampToValueAtTime(0, t + dur * 0.7);
      osc.connect(g).connect(ac.destination);
      osc.start(t);
      osc.stop(t + dur);
      t += dur;
    }
  } catch (_) { /* no AudioContext, private mode, broken browser — ignore */ }
}

const PINNED_MESSAGES = [
  'Hello from 2031, anyone reading this?',
  'i love you, please don\'t forget.',
  'mom i made it',
  'first day of the rest of everything',
  'still humming that song from august',
  'the cat is fine. the cat is fine.',
  'we met here ◡̈',
  'do not be afraid of the next part',
  'buying bitcoin feels weird today',
  'it rained for nine days straight',
  '🪐',
  '(͡° ͜ʖ ͡°) <— hello from the old internet',
  'i forgot to eat lunch',
  'two thumbs up. ten toes.',
  'this is the smallest monument i\'ve ever owned',
  'reading in 2090? say hi.',
  'they finally fixed the bus',
  'i keep starting over',
  'tiny square, weird feeling',
  'greetings from a kitchen in oslo',
  'supplies: hope, duct tape, lilies',
  'omw to the next chapter',
  'still here. still laughing. still scared.',
  'i voted today!',
  'the bread was perfect',
  'a letter to no one in particular',
  'kiss the next person you see',
  'do you remember this exact second?',
  'i prefer this version of me',
  'planted the basil. it\'s been three weeks.',
  'hi, future. i hope you\'re okay.',
  '(╯°□°)╯︵ ┻━┻',
  'still thinking about that band',
  'long way from the first commit',
  'wish you were here',
  'the building fell but i didn\'t',
  'going to sleep, will revive tomorrow',
  'i forgive myself for 2019',
  'monday feels like a color',
  'i was here. i meant it. ✿',
  'the dog knows what he did',
  'greetings, traveler',
  'i love you, stranger',
  'it tastes like lemon',
  'a tiny prayer, a tiny square',
  'this is for the quiet kids',
  'do not skip leg day',
  'still on the way up',
  'left a nickle in the wall',
  'do not forget to look up',
  'hi.',
  'tiny mark, big day',
  'fourteen birds landed at once',
  'still rooting for you',
  'the lilacs finally came in',
  'the future is gonna be okay',
  'remember when we thought 2026 was wild?',
  'i wrote you from a train',
  'saving this for the bad days',
  'good morning',
  'i made a tiny ship',
  'still choosing joy',
  'this tile is for my grandma',
  'tell the next one: keep going',
  'butter, sugar, flour, time',
  'on purpose, with care',
  'i was nineteen and i meant it',
  'til we meet ◡',
  'a small window, a long view',
  'remember: the moon is the sun in disguise',
  'my mother\'s laugh lives here',
  'petrichor',
  'it is enough. it was always enough.',
  'hello from a library in lisbon',
  'tell my mom i\'m thriving',
  'my heart is in the right place',
  'the bread rose twice',
  'i forgive myself for yesterday',
  'this square is exactly my size',
  'the dog was a good dog',
  'i met a stranger i became',
  'eat the cake.',
  'greetings from the year of the horse',
  'behold: a fossil from the present',
  'sunlight on the floor of my apartment',
  'still trying, still failing, still laughing',
  'i love everyone i ever loved',
  'it\'s going to be okay. i think.',
  'plant something.',
  'read the room, then read a book',
  'tiny, brave, permanent',
  'i was here in the year of small joys',
  'long live the deep cut',
  'you are not alone',
  'sourdough, sunsets, slow days',
  'still dancing in the kitchen',
  'remember the dumb joke we made',
  'four more minutes until lunch',
  'i keep the small lights on',
  'thank you, kind stranger',
  'the cat finally sat on the laptop',
  'i forgive myself a year early',
  'it was a good weird day',
  'chop wood, carry water, repeat',
  'one day closer to the next strange joy',
  'i was here. i am here. ♥',
  'greetings from a small apartment',
  'tell me about the weather in 2099',
  'remember: today is mostly fine',
  'it wasn\'t the last time',
  'the tomatoes finally grew',
  'tiny, electric, here',
  'goodnight moon',
];

/* ---------- DOM helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const escapeHtml = (str) =>
  String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

/* ---------- Deterministic PRNG (mulberry32) ---------- */
function makePRNG(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Shared seed timestamp range — used by BOTH first-visit and stored-visit branches
   so seeded tiles always look like they were captured between Jan 2026 and Jan 2027. */
const SEED_TS_BASE = Date.UTC(2026, 0, 1);
const SEED_TS_SPAN = 1000 * 60 * 60 * 24 * 365;  // 1 year
function seedTimestamp(rng) {
  return SEED_TS_BASE + Math.floor(rng() * SEED_TS_SPAN);
}

/* ---------- Tile color from text (warm muted palette) ---------- */
const TILE_PALETTE = [
  '#d97757', '#c87f4d', '#a45a3d', '#7a4a3a',
  '#5a6a4a', '#3a6a5a', '#3a5a6a', '#4a3a6a',
  '#6a3a5a', '#a45a76', '#c87f6e', '#e3a567',
  '#c4a04a', '#8a6e3a', '#6e8a5a', '#4a8a7a',
  '#3a7a8a', '#5a4a8a', '#7a3a6a', '#a83a4a',
  '#c44a3a', '#e07a3a', '#e3a050', '#c89a4a',
  '#9a8a4a', '#5a7a3a', '#3a8a4a', '#3a8a7a',
  '#3a6a8a', '#4a3a7a', '#7a3a7a', '#8a3a5a',
  '#a84a6a', '#c45a7a', '#e36a8a', '#e3887a',
  '#d97a5a', '#a86a4a', '#8a5a3a', '#6e5a4a',
  '#5a8a5a', '#3a8a5a', '#3a9a8a', '#3a8a9a',
  '#4a6a9a', '#5a4a9a', '#7a4a7a', '#9a3a6a',
];

function tileColorFor(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return TILE_PALETTE[Math.abs(h) % TILE_PALETTE.length];
}

/* ---------- State ---------- */
const tiles = new Map();
const starter = { firstTimestamp: Date.now() };

/* ---------- Storage ---------- */
function loadTiles() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : null;
  } catch (e) {
    return null;
  }
}

function saveTiles() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(tiles.values())));
  } catch (e) { /* private mode / quota */ }
}

function tileId(x, y) { return y * GRID_SIZE + x; }

/* ---------- Pre-seed a deterministic initial board ---------- */
function seedDeterministic(rng) {
  const targetCount = Math.round(TOTAL_TILES * SEED_PERCENT);
  let placed = 0;
  let attempts = 0;
  while (placed < targetCount && attempts < targetCount * 8) {
    attempts++;
    const id = Math.floor(rng() * TOTAL_TILES);
    if (tiles.has(id)) continue;
    const x = id % GRID_SIZE;
    const y = Math.floor(id / GRID_SIZE);
    const idx = Math.floor(rng() * PINNED_MESSAGES.length);
    const text = PINNED_MESSAGES[idx];
    tiles.set(id, {
      id, x, y,
      text,
      emoji: extractEmoji(text),
      handle: rng() < 0.55 ? null : pickHandle(rng),
      timestamp: seedTimestamp(rng),
      isSeeded: true,
    });
    placed++;
  }
}

function seedIntoEmptyCells(rng, targetCount) {
  let placed = 0;
  let attempts = 0;
  while (placed < targetCount && attempts < targetCount * 8) {
    attempts++;
    const id = Math.floor(rng() * TOTAL_TILES);
    if (tiles.has(id)) continue;
    const x = id % GRID_SIZE;
    const y = Math.floor(id / GRID_SIZE);
    const msgIdx = Math.floor(rng() * PINNED_MESSAGES.length);
    const text = PINNED_MESSAGES[msgIdx];
    tiles.set(id, {
      id, x, y,
      text,
      emoji: extractEmoji(text),
      handle: rng() < 0.55 ? null : pickHandle(rng),
      timestamp: seedTimestamp(rng),
      isSeeded: true,
    });
    placed++;
  }
}

const HANDLE_BANK = [
  'anon', 'a stranger', 'a kid from ohio', 'someone from tokyo',
  'a tired adult', 'the night shift', 'a florist', 'a librarian',
  'first-time buyer', 'a cat', 'a pigeon', 'a coder', 'a poet',
  'no one in particular', 'someone\'s mom', 'a ghost', 'the rain',
];

function pickHandle(rng) {
  return HANDLE_BANK[Math.floor(rng() * HANDLE_BANK.length)];
}

function extractEmoji(text) {
  const m = text.match(/\p{Extended_Pictographic}/u);
  return m ? m[0] : '';
}

/* ================================================
   SUPABASE — optional shared backend + Auth
   ================================================ */
const SUPABASE = {
  url:     (typeof window.__SUPABASE_URL__      === 'string' && window.__SUPABASE_URL__      !== 'https://YOUR-PROJECT.supabase.co') ? window.__SUPABASE_URL__      : null,
  anonKey: (typeof window.__SUPABASE_ANON_KEY__ === 'string' && window.__SUPABASE_ANON_KEY__ !== 'YOUR-ANON-KEY')                     ? window.__SUPABASE_ANON_KEY__ : null,
  client:    null,
  enabled:   false,
  channel:   null,
  auth: {
    user: null,
    session: null,
  },
};

/* ================================================
   STRIPE — optional real payments
   ================================================ */
const STRIPE_PUBLISHABLE_KEY = (typeof window.__STRIPE_PK__ === 'string' && /^pk_(test|live)_[A-Za-z0-9]+$/.test(window.__STRIPE_PK__))
  ? window.__STRIPE_PK__
  : null;
const HAS_STRIPE = !!STRIPE_PUBLISHABLE_KEY;

const selfClaimedIds = new Set();
const SELF_STORAGE_KEY = 'tcb.self.v1';
function loadSelfClaimedIds() {
  try {
    const raw = localStorage.getItem(SELF_STORAGE_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) arr.forEach(id => selfClaimedIds.add(Number(id)));
  } catch (_) { /* */ }
}
function saveSelfClaimedIds() {
  try {
    localStorage.setItem(SELF_STORAGE_KEY, JSON.stringify(Array.from(selfClaimedIds)));
  } catch (_) { /* */ }
}
const recentClaims = [];
function addRecentClaim(record) {
  recentClaims.unshift(record);
  if (recentClaims.length > 50) recentClaims.length = 50;
}

async function initSupabase() {
  if (!SUPABASE.url || !SUPABASE.anonKey) return false;
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    console.warn('[supabase] library not loaded — falling back to localStorage.');
    return false;
  }
  try {
    SUPABASE.client = window.supabase.createClient(SUPABASE.url, SUPABASE.anonKey, {
      realtime: { params: { eventsPerSecond: 10 } },
      auth: { persistSession: true, autoRefreshToken: true },
    });
    const { error } = await SUPABASE.client.from('tiles').select('id').limit(1);
    if (error) throw error;
    SUPABASE.enabled = true;
    // Restore any cached session so the faction UI knows if we're logged in.
    const { data } = await SUPABASE.client.auth.getSession();
    SUPABASE.auth.session = data?.session || null;
    SUPABASE.auth.user    = data?.session?.user || null;
    return true;
  } catch (e) {
    console.warn('[supabase] unreachable — falling back to localStorage.', e?.message || e);
    return false;
  }
}

function rowToTile(row) {
  return {
    id:            Number(row.id),
    x:             Number(row.x),
    y:             Number(row.y),
    text:          String(row.text || ''),
    emoji:         row.emoji || '',
    handle:        row.handle || null,
    timestamp:     Date.parse(row.timestamp || row.created_at || Date.now()),
    isSeeded:      false,
    tier:          row.tier || null,
    audio_chip_id: row.audio_chip_id || null,
    lock_kind:     row.lock_kind || null,
    faction_id:    row.faction_id || null,
    addons_total_cents: Number(row.addons_total_cents) || 0,
  };
}

async function dbLoadTiles() {
  const { data, error } = await SUPABASE.client.from('tiles').select('*').order('id', { ascending: true });
  if (error) throw error;
  return (data || []).map(rowToTile);
}

async function dbInsertTile(record) {
  const row = {
    id:        record.id,
    x:         record.x,
    y:         record.y,
    text:      record.text,
    emoji:     record.emoji || null,
    handle:    record.handle || null,
    timestamp: new Date(record.timestamp).toISOString(),
  };
  const { error } = await SUPABASE.client.from('tiles').insert(row);
  if (error) return { error, conflict: error.code === '23505' };
  return { ok: true };
}

function dbSubscribeInserts(handler) {
  return SUPABASE.client
    .channel('public:tiles')
    .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'tiles' },
        (payload) => handler(rowToTile(payload.new)))
    .subscribe();
}

async function dbSeedArchiveIfEmpty() {
  if (tiles.size > 0) return false;
  const rng = makePRNG(0xc0ffee);
  const target = Math.round(TOTAL_TILES * SEED_PERCENT);
  const rows = [];
  const seen = new Set();
  while (rows.length < target) {
    const id = Math.floor(rng() * TOTAL_TILES);
    if (seen.has(id)) continue;
    seen.add(id);
    const text = PINNED_MESSAGES[Math.floor(rng() * PINNED_MESSAGES.length)];
    rows.push({
      id,
      x:         id % GRID_SIZE,
      y:         Math.floor(id / GRID_SIZE),
      text,
      emoji:     extractEmoji(text),
      handle:    rng() < 0.55 ? null : pickHandle(rng),
      timestamp: new Date(seedTimestamp(rng)).toISOString(),
    });
  }
  const { error } = await SUPABASE.client.from('tiles').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
  if (error) console.warn('[supabase] auto-seed:', error.message);
  return !error;
}

/* ---------- Loading + mode label UI helpers ---------- */
function setBillboardLoading(on) {
  const f = document.querySelector('.billboard-frame');
  if (f) f.setAttribute('data-loading', on ? 'true' : 'false');
}

function archiveModeLabel(label) {
  const el = document.getElementById('archive-mode');
  if (el) el.textContent = `archive · ${label}`;
}

/* ---------- Grid render ---------- */
const grid = $('#grid');

function renderGrid() {
  grid.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const id = tileId(x, y);
      const btn = document.createElement('button');
      btn.className = 'tile tile--empty';
      btn.type = 'button';
      btn.dataset.id = id;
      btn.dataset.x = x;
      btn.dataset.y = y;
      // Tier hint on empty tiles so the catalog of prime real estate is visible
      // even before someone buys one.
      const tier = pricingTier(x, y);
      if (tier) btn.classList.add(`tile--tier-hint-${tier}`);
      btn.setAttribute('aria-label', `Tile ${id} (empty${tier ? ' · ' + tier : ''})`);
      frag.appendChild(btn);
    }
  }
  grid.appendChild(frag);

  grid.addEventListener('click', onTileClick);
  grid.addEventListener('mouseover', onTileEnter);
  grid.addEventListener('mouseout', onTileLeave);
  grid.addEventListener('mousemove', positionTooltip);
}

function commitTileToDOM(tile) {
  const el = grid.querySelector(`.tile[data-id="${tile.id}"]`);
  if (!el) return;
  el.classList.remove('tile--empty');
  // Drop tier hint now that the cell is filled.
  ['tile--tier-hint-legendary','tile--tier-hint-corner','tile--tier-hint-prime'].forEach(c => el.classList.remove(c));
  el.classList.add('tile--filled');
  el.style.setProperty('--tile-color', tileColorFor(tile.text));
  const emoji = tile.emoji || '';
  if (emoji) {
    const e = document.createElement('span');
    e.className = 'tile__emoji';
    e.textContent = emoji;
    el.textContent = '';
    el.appendChild(e);
  }
  el.setAttribute(
    'aria-label',
    `Tile ${tile.id}: ${tile.text}${emoji ? ' ' + emoji : ''}${tile.audio_chip_id ? ' · audio' : ''}${tile.lock_kind ? ' · locked' : ''}`
  );

  // Tier + audio + lock indicator classes
  if (tile.tier) el.classList.add(`tile--tier-${tile.tier}`);
  if (tile.audio_chip_id) el.classList.add('tile--audio');
  if (tile.lock_kind === 'passphrase') el.classList.add('tile--locked');
  if (tile.faction_id) el.classList.add('tile--faction');

  // Pulse animation when newly minted
  el.classList.remove('tile--pulse');
  void el.offsetWidth;
  el.classList.add('tile--pulse');

  // Fossilization only fires on FRESH commit (not on bulk re-render). The
  // realtime subscriber + finalizePurchase set this flag before calling commit.
  if (tile.__freshlyCommitted) {
    el.classList.remove('tile--fossilize');
    void el.offsetWidth;
    el.classList.add('tile--fossilize');
    el.addEventListener('animationend', () => el.classList.remove('tile--fossilize'), { once: true });
  }
}

function commitFreshTile(tile) {
  tile.__freshlyCommitted = true;
  tiles.set(tile.id, tile);
  commitTileToDOM(tile);
}

/* ---------- Tooltip ---------- */
const tooltip = $('#tooltip');

function onTileEnter(e) {
  const tile = e.target.closest('.tile');
  if (!tile) return;
  const id = parseInt(tile.dataset.id, 10);
  const data = tiles.get(id);
  const x = parseInt(tile.dataset.x, 10);
  const y = parseInt(tile.dataset.y, 10);
  if (data) {
    if (data.lock_kind === 'passphrase') {
      tooltip.innerHTML = `<span class="tooltip__id">#${String(id).padStart(4, '0')}</span>  <span class="tooltip__msg">🔒 locked tile · passphrase required</span>`;
    } else {
      tooltip.innerHTML = `<span class="tooltip__id">#${String(id).padStart(4, '0')}</span>  <span class="tooltip__msg">${escapeHtml(data.text.slice(0, 80))}</span>`;
    }
  } else {
    const tier = pricingTier(x, y);
    const tierLabel = tier ? ` · ${tier}` : '';
    const price = tilePriceCents(x, y);
    tooltip.innerHTML = `<span class="tooltip__id">#${String(id).padStart(4, '0')}</span>  <span class="tooltip__msg">empty · ${formatUsdCents(price.total)}${tierLabel} · click to claim</span>`;
  }
  tooltip.classList.add('is-visible');
  tooltip.setAttribute('aria-hidden', 'false');
  positionTooltip(e);
}

function onTileLeave(_e) {
  tooltip.classList.remove('is-visible');
  tooltip.setAttribute('aria-hidden', 'true');
}

function positionTooltip(e) {
  const x = e.clientX;
  const y = e.clientY;
  tooltip.style.left = x + 'px';
  tooltip.style.top  = y + 'px';
}

/* ---------- Tile click → modal ---------- */
function onTileClick(e) {
  const tile = e.target.closest('.tile');
  if (!tile) return;
  const id = parseInt(tile.dataset.id, 10);
  const x = id % GRID_SIZE;
  const y = Math.floor(id / GRID_SIZE);
  $('#visible-coord').textContent = `viewing: ${String(x).padStart(2,'0')},${String(y).padStart(2,'0')}`;
  const data = tiles.get(id);
  if (data) {
    if (data.lock_kind === 'passphrase') {
      openLockedModal(data);
    } else {
      openViewModal(data);
      if (data.audio_chip_id) playChip(data.audio_chip_id);
    }
  } else {
    openClaimModal({ id, x, y });
  }
}

/* ---------- Modal ---------- */
const modalRoot = $('#modal-root');
const modalEl   = $('.modal', modalRoot);
let lastFocused = null;

function modalFocusables() {
  return $$('button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])', modalEl);
}

function openModal(html) {
  lastFocused = document.activeElement;
  modalEl.innerHTML =
    `<button class="modal__close" data-close aria-label="Close">×</button>${html}`;
  modalRoot.classList.add('is-open');
  modalRoot.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  queueMicrotask(() => {
    const f = modalEl.querySelector('input, textarea, button:not(.modal__close)');
    if (f) f.focus();
  });
}

function closeModal() {
  modalRoot.classList.remove('is-open');
  modalRoot.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  if (lastFocused && typeof lastFocused.focus === 'function') {
    lastFocused.focus();
  }
}

modalRoot.addEventListener('click', (e) => {
  if (e.target.matches('[data-close]')) closeModal();
});

document.addEventListener('keydown', (e) => {
  if (!modalRoot.classList.contains('is-open')) return;
  if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
  if (e.key !== 'Tab') return;
  const focusables = modalFocusables();
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last  = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

/* ---------- View modal (existing tile) ---------- */
function openViewModal(data) {
  const date = new Date(data.timestamp);
  const iso = date.toISOString().replace('T', ' ').replace(/\..+$/, ' UTC');
  const handle = data.handle || 'anonymous';
  const initial = handle.replace(/^(a |an )?/i, '').charAt(0).toUpperCase();
  const stats = computeStats();
  const addonBadges = [
    data.audio_chip_id ? `<span class="badge badge--chip" title="${escapeHtml(data.audio_chip_id)}">♪ audio</span>` : '',
    data.faction_id ? `<span class="badge badge--faction">faction</span>` : '',
    data.tier ? `<span class="badge badge--tier-${escapeHtml(data.tier)}">${escapeHtml(data.tier)}</span>` : '',
  ].filter(Boolean).join(' ');
  openModal(`
    <div class="modal__ribbon">inspecting tile · #${String(data.id).padStart(4, '0')}</div>
    <h2 class="modal__heading" id="modal-title">
      ${data.emoji ? escapeHtml(data.emoji) + ' ' : ''}${escapeHtml(data.text)}
    </h2>
    <div class="modal__sub">
      <span>coord ${String(data.x).padStart(2,'0')},${String(data.y).padStart(2,'0')}</span>
      <span>·</span>
      <span>${iso}</span>
      <span>·</span>
      <span>tile #${data.id + 1} of ${TOTAL_TILES.toLocaleString()}</span>
    </div>
    ${addonBadges ? `<div class="addon-badges">${addonBadges}</div>` : ''}
    <div class="modal__handle">
      <span class="modal__avatar">${escapeHtml(initial)}</span>
      <span>— ${escapeHtml(handle)}</span>
    </div>
    <p class="modal__msg">&ldquo;${escapeHtml(data.text)}&rdquo;</p>
    <div class="modal__actions">
      <button class="btn" data-share="${data.id}">share tile #${data.id}</button>
      <button class="btn btn--ghost" data-close>close</button>
    </div>
    <div class="mono mono--dim" style="margin-top:18px; display:flex; justify-content:space-between; gap:8px;">
      <span>${stats.available.toLocaleString()} tiles still empty</span>
      <span>last claim ${stats.lastAgo}</span>
    </div>
  `);
  modalEl.querySelector('[data-share]')?.addEventListener('click', () => shareTile(data));
}

/* ---------- Locked modal (passphrase gate) ---------- */
function openLockedModal(data, attempt) {
  openModal(`
    <div class="modal__ribbon">🔒 locked tile · #${String(data.id).padStart(4, '0')}</div>
    <h2 class="modal__heading" id="modal-title">This one is sealed.</h2>
    <p class="modal__sub">the author set a passphrase. enter it to read what they wrote.</p>
    <form id="unlock-form" novalidate>
      <label class="field">
        <span class="field__label">
          <span>passphrase</span>
          <span class="field__count" data-count>0</span>
        </span>
        <input class="field__input" type="password" name="passphrase" maxlength="200" autocomplete="off" required autofocus />
      </label>
      <div id="unlock-error" class="mono mono--accent" style="margin-top:14px; min-height:1em; font-size:0.78rem;" role="alert"></div>
      <div class="modal__actions">
        <button type="submit" class="btn btn--accent">try to unlock</button>
        <button type="button" class="btn btn--ghost" data-close>give up</button>
      </div>
    </form>
  `);
  const form = $('#unlock-form', modalEl);
  const errEl = $('#unlock-error', modalEl);
  const countEl = $('[data-count]', form);
  const input = form.elements['passphrase'];
  input.addEventListener('input', () => { countEl.textContent = input.value.length; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    errEl.textContent = 'checking…';
    try {
      const res = await fetch('/.netlify/functions/unlock-tile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tile_id: data.id, passphrase: input.value }),
      });
      const body = await res.json();
      if (!res.ok) {
        submitBtn.disabled = false;
        errEl.textContent = body.error === 'wrong passphrase'
          ? `wrong passphrase${(attempt || 0) > 0 ? ' (attempt ' + ((attempt || 0) + 1) + ')' : ''}.`
          : (body.error || 'unlock failed');
        shake(input);
        return;
      }
      // Reveal the unlocked message and play its audio (if any).
      const revealed = { ...data, text: body.text, emoji: body.emoji, handle: body.handle };
      openViewModal(revealed);
      if (revealed.audio_chip_id) playChip(revealed.audio_chip_id);
    } catch (e) {
      submitBtn.disabled = false;
      errEl.textContent = 'network error';
    }
  });
}

/* ---------- Claim modal (empty tile) ---------- */
const EMOJI_BANK = [
  '◡̈','✦','♥','✿','☀','☾','☂','❀','✿','❍','◔','◕','∴','☼','☁','☃',
  '⟁','⟁','♔','⌬','⌖','⎈','⎊','⏚','⏛','◌','◍','◎','◯','◐','◑','◒','◓','◔','◕','◖','◗',
  '⨯','⨉','⨊','⨋','⩇','⩈','⩉','ᐛ','ᕕ','ᕗ','ᕘ','ᕙ','ᕚ','ᕛ','ᕜ','ᕝ','ᕞ','ᕠ','ᕡ','ᕢ','ᕣ','ᕤ','ᕥ','ᕦ','ᕧ','ᕨ','ᕩ','ᕪ',
];

function openClaimModal({ id, x, y }) {
  const stats = computeStats();
  const initialPrice = tilePriceCents(x, y);
  const initialTierBadge = initialPrice.tier || 'common';
  const initialTierText = initialPrice.tier
    ? `${initialPrice.tier} tile · +${formatUsdCents(initialPrice.surcharge)} surcharge`
    : 'common tier — no surcharge';

  openModal(`
    <div class="modal__ribbon">claim tile · #${String(id).padStart(4, '0')}</div>
    <h2 class="modal__heading" id="modal-title">Pick your ten square pixels.</h2>
    <div class="modal__sub">
      <span>coord ${String(x).padStart(2,'0')},${String(y).padStart(2,'0')}</span>
      <span>·</span>
      <span>${stats.filled.toLocaleString()} of 10,000 already in archive</span>
    </div>

    <form id="claim-form" novalidate>
      <label class="field">
        <span class="field__label">
          <span>your message</span>
          <span class="field__count"><span data-count>0</span> / ${MAX_MESSAGE_CHARS}</span>
        </span>
        <textarea class="field__textarea" name="text" maxlength="${MAX_MESSAGE_CHARS}" placeholder="One sentence, one joke, one prayer…" required></textarea>
      </label>

      <label class="field">
        <span class="field__label">
          <span>sign with your handle (or stay anon)</span>
          <span class="field__count">optional</span>
        </span>
        <input class="field__input" name="handle" maxlength="${MAX_HANDLE_CHARS}" placeholder="@your-name — leave blank to stay anonymous" />
      </label>

      <div class="field">
        <span class="field__label">
          <span>pick an emoji (optional)</span>
          <span class="field__count" data-emoji-state>none</span>
        </span>
        <div class="emoji-row" role="radiogroup" aria-label="Emoji picker">
          ${EMOJI_BANK.slice(0, 24).map(e => `<button type="button" data-emoji="${e}">${e}</button>`).join('')}
          <button type="button" data-emoji="">∅</button>
        </div>
      </div>

      <div class="field" data-tier-preview>
        <span class="field__label">
          <span>tier</span>
          <span class="tier-badge tier-badge--${initialTierBadge}" data-tier-badge>${initialTierBadge}</span>
        </span>
        <p class="mono mono--dim" style="margin:0; font-size:0.78rem;" data-tier-text>${initialTierText}</p>
      </div>

      <div class="field">
        <span class="field__label">
          <span>audio chip <span style="opacity:.6;">+$1.00</span></span>
          <span class="field__count" data-chip-state>none</span>
        </span>
        <div class="chip-row" role="radiogroup" aria-label="Audio chip picker">
          ${AUDIO_CHIP_CATALOG.map(c => `<button type="button" data-chip="${c.id}">${c.name}</button>`).join('')}
          <button type="button" data-chip="">∅</button>
        </div>
        <button type="button" class="btn btn--ghost" data-chip-sample style="margin-top:8px; font-size:0.78rem;">▶ preview last</button>
      </div>

      <div class="field">
        <span class="field__label">
          <span>lock with passphrase <span style="opacity:.6;">free</span></span>
          <span class="field__count" data-lock-state>none</span>
        </span>
        <input class="field__input" type="password" name="lock_passphrase" maxlength="200" autocomplete="new-password" placeholder="optional · leave blank to leave your tile open" />
        <p class="modal__msg modal__msg--dim" style="margin:8px 0 0; font-size:0.78rem;">only people who know the phrase will be able to read it. we can't recover forgotten phrases.</p>
      </div>

      <div class="handle-toggle">
        <label>
          <input type="checkbox" name="as-forever" checked />
          i understand this is <em>permanent</em> — no edits, no takedowns.
        </label>
      </div>

      <div class="price-summary">
        <span data-price-label>${initialPrice.tier ? initialPrice.tier + ' tile + base' : 'this tile · one-time · forever'}</span>
        <span class="price-summary__price" data-price-amount>${formatUsdCents(initialPrice.total)}</span>
      </div>

      <div class="modal__actions">
        <button type="submit" class="btn btn--accent" ${stats.available === 0 ? 'disabled' : ''}>
          claim tile #${id} · <span data-submit-price>${formatUsdCents(initialPrice.total)}</span>
        </button>
        <button type="button" class="btn btn--ghost" data-close>cancel</button>
      </div>
    </form>
  `);

  const form = $('#claim-form', modalEl);
  const textArea = form.elements['text'];
  const countEl = $('[data-count]', form);
  const emojiRow = $('.emoji-row', form);
  const chipRow  = $('.chip-row', form);
  const lockInput = form.elements['lock_passphrase'];
  const submitBtn = form.querySelector('button[type=submit]');
  const priceAmtEl    = $('[data-price-amount]', form);
  const priceLabelEl  = $('[data-price-label]', form);
  const submitPriceEl = $('[data-submit-price]', form);
  const tierBadgeEl   = $('[data-tier-badge]', form);
  const tierTextEl    = $('[data-tier-text]', form);

  let chosenEmoji = '';
  let chosenChip  = '';
  let lastSamplePreview = '';

  textArea.addEventListener('input', () => { countEl.textContent = textArea.value.length; });

  emojiRow.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-emoji]');
    if (!btn) return;
    emojiRow.querySelectorAll('[data-emoji]').forEach(b => b.classList.remove('is-selected'));
    btn.classList.add('is-selected');
    chosenEmoji = btn.dataset.emoji;
    $('[data-emoji-state]', form).textContent = chosenEmoji || 'none';
  });

  chipRow.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-chip]');
    if (!btn) return;
    chipRow.querySelectorAll('[data-chip]').forEach(b => b.classList.remove('is-selected'));
    btn.classList.add('is-selected');
    chosenChip = btn.dataset.chip;
    $('[data-chip-state]', form).textContent = chosenChip || 'none';
    if (chosenChip) lastSamplePreview = chosenChip;
  });

  lockInput.addEventListener('input', () => {
    $('[data-lock-state]', form).textContent = lockInput.value ? 'set' : 'none';
  });

  const pricePreview = form.querySelector('[data-chip-sample]');
  if (pricePreview) {
    pricePreview.addEventListener('click', () => {
      if (lastSamplePreview) playChip(lastSamplePreview);
      else toast('pick a chip first to preview');
    });
  }

  function refreshPrice() {
    const p = tilePriceCents(x, y, { audio_chip_id: chosenChip, lock_passphrase: lockInput.value });
    priceAmtEl.textContent    = formatUsdCents(p.total);
    submitPriceEl.textContent = formatUsdCents(p.total);
    priceLabelEl.textContent = (p.tier ? `${p.tier} tile + base` : 'this tile · one-time · forever');
    const tierShown = p.tier || 'common';
    tierBadgeEl.textContent = tierShown;
    tierBadgeEl.className = `tier-badge tier-badge--${tierShown}`;
    tierTextEl.textContent = p.tier
      ? `${p.tier} tile · +${formatUsdCents(p.surcharge)} surcharge`
      : 'common tier — no surcharge';
  }

  // Live update
  chipRow.addEventListener('click', () => refreshPrice());
  lockInput.addEventListener('input', refreshPrice);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = textArea.value.trim().slice(0, MAX_MESSAGE_CHARS);
    if (!text) { shake(textArea); return; }
    if (!form.elements['as-forever'].checked) {
      toast('you must accept permanence to claim a tile');
      return;
    }
    const handle = form.elements['handle'].value.trim().slice(0, MAX_HANDLE_CHARS) || null;
    processPayment({
      id, x, y, text,
      emoji: chosenEmoji,
      handle,
      audio_chip_id: chosenChip,
      lock_passphrase: lockInput.value.trim(),
    });
  });
}

function shake(el) {
  el.animate(
    [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-6px)' },
      { transform: 'translateX(6px)' },
      { transform: 'translateX(-4px)' },
      { transform: 'translateX(0)' },
    ],
    { duration: 280, easing: 'ease-out' }
  );
  el.focus();
}

/* ---------- Mock Stripe payment ---------- */
async function processPayment(payload) {
  if (HAS_STRIPE) return processStripePayment(payload);
  const p = tilePriceCents(payload.x, payload.y, { audio_chip_id: payload.audio_chip_id, lock_passphrase: payload.lock_passphrase });
  const logs = [
    '[stripe] creating payment intent for ' + formatUsdCents(p.total),
    '[stripe] customer not stored. privacy first.',
    '[stripe] intent created · pi_3N6' + Math.random().toString(36).slice(2, 12),
    '[stripe] confirming…',
    '[stripe] payment succeeded',
    '[ledger] writing tile #' + payload.id + ' to permanent archive',
    '[ledger] timestamp frozen to the millisecond',
  ];
  showPaymentModal(payload, logs);
}

function showPaymentModal(payload, logs) {
  openModal(`
    <div class="modal__ribbon">processing payment</div>
    <h2 class="modal__heading" id="modal-title">Charging your card.</h2>
    <p class="modal__sub" style="margin-bottom:18px;">this takes about two seconds · no card details leave this device</p>
    <div class="payment">
      <div class="payment__step">stripe · test mode</div>
      <div class="payment__bar"></div>
      <div class="payment__logs" id="payment-logs"></div>
    </div>
  `);
  const logsEl = $('#payment-logs', modalEl);
  let i = 0;
  const tick = setInterval(() => {
    if (i >= logs.length) {
      clearInterval(tick);
      setTimeout(() => finalizePurchase(payload).catch((e) => {
        console.error('purchase failed', e);
        openErrorModal("couldn't save your tile. try again in a moment.");
      }), 280);
      return;
    }
    const p = document.createElement('p');
    p.textContent = logs[i++];
    logsEl.appendChild(p);
    logsEl.scrollTop = logsEl.scrollHeight;
  }, 260);
}

/* ---------- Real Stripe (Payment Element) ---------- */
async function processStripePayment(payload) {
  let res, body;
  try {
    res = await fetch('/.netlify/functions/create-payment-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'single',
        tile_id:          payload.id,
        text:             payload.text,
        emoji:            payload.emoji || '',
        handle:           payload.handle || '',
        audio_chip_id:    payload.audio_chip_id || '',
        lock_passphrase:  payload.lock_passphrase || '',
        buyer_email:      '',
      }),
    });
  } catch (e) {
    openErrorModal("couldn't reach the payment service. check your connection.");
    return;
  }
  if (!res.ok) {
    try { body = await res.json(); } catch { body = {}; }
    if (res.status === 409) openConflictModal(payload.id);
    else openErrorModal(body.error || "couldn't start payment. try again.");
    return;
  }
  const { client_secret: clientSecret } = await res.json();
  showStripePaymentModal(payload, clientSecret);
}

function showStripePaymentModal(payload, clientSecret) {
  const price = tilePriceCents(payload.x, payload.y, { audio_chip_id: payload.audio_chip_id, lock_passphrase: payload.lock_passphrase });
  const itemized = [
    `${price.tier ? price.tier + ' tier' : 'base'} · ${formatUsdCents(price.base)}`,
    payload.audio_chip_id ? `audio chip · +${formatUsdCents(price.audio)}` : '',
    payload.lock_passphrase ? `passphrase lock · ${formatUsdCents(price.lock)}` : '',
  ].filter(Boolean).join(' / ');
  openModal(`
    <div class="modal__ribbon">claim tile · #${String(payload.id).padStart(4, '0')}</div>
    <h2 class="modal__heading" id="modal-title">${formatUsdCents(price.total)} for one square pixel.</h2>
    <p class="modal__sub" style="margin-bottom:18px;">card payment processed by stripe · card details never touch our server</p>
    <p class="modal__msg">&ldquo;${escapeHtml(payload.text)}&rdquo;${payload.emoji ? ' ' + escapeHtml(payload.emoji) : ''}</p>
    <div class="field">
      <span class="field__label"><span>card details</span></span>
      <div id="stripe-payment-element"></div>
    </div>
    <div class="price-summary">
      <span>${itemized}</span>
      <span class="price-summary__price">${formatUsdCents(price.total)}</span>
    </div>
    <div id="stripe-error" class="mono mono--accent" role="alert" style="margin-top:14px; min-height:1em; font-size:0.78rem;"></div>
    <div class="modal__actions" style="justify-content:space-between;">
      <button type="button" class="btn btn--ghost" data-close>cancel</button>
      <button type="button" class="btn btn--accent" id="stripe-pay-btn">pay ${formatUsdCents(price.total)} → claim tile</button>
    </div>
  `);
  const submitBtn = $('#stripe-pay-btn', modalEl);
  const errEl     = $('#stripe-error', modalEl);
  try {
    const stripe   = window.Stripe(STRIPE_PUBLISHABLE_KEY);
    const elements = stripe.elements({ clientSecret });
    const paymentElement = elements.create('payment', { layout: 'tabs' });
    paymentElement.mount('#stripe-payment-element');
    submitBtn.addEventListener('click', async () => {
      submitBtn.disabled = true;
      errEl.textContent  = 'contacting your bank…';
      const { error } = await stripe.confirmPayment({ elements, redirect: 'if_required' });
      if (error) {
        submitBtn.disabled = false;
        errEl.textContent  = error.message || 'payment failed';
        return;
      }
      errEl.textContent = 'your bank cleared it. etching your inscription…';
      if (SUPABASE.enabled) {
        const ok = await waitForTileInArchive(payload.id, 12000);
        if (!ok) {
          openErrorModal('your card was charged but the inscription took too long to verify. refresh in a moment — your tile will appear once it does.');
          return;
        }
      }
      finalizePurchase(payload);
    });
  } catch (e) {
    console.error('stripe init failed', e);
    openErrorModal('payment system failed to initialize.');
  }
}

async function waitForTileInArchive(tileId, timeoutMs = 12000) {
  if (tiles.has(tileId)) return true;
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (tiles.has(tileId)) return resolve(true);
      if (Date.now() - start > timeoutMs) return resolve(false);
      setTimeout(tick, 200);
    };
    tick();
  });
}

async function finalizePurchase(payload) {
  const now = Date.now();
  const record = {
    id:        payload.id,
    x:         payload.x,
    y:         payload.y,
    text:      payload.text,
    emoji:     payload.emoji || extractEmoji(payload.text),
    handle:    payload.handle,
    timestamp: now,
    isSeeded:  false,
    tier:          payload.tier || null,
    audio_chip_id: payload.audio_chip_id || null,
    lock_kind:     payload.lock_passphrase ? 'passphrase' : null,
  };

  if (SUPABASE.enabled) {
    if (HAS_STRIPE) {
      // Server already wrote the canonical row; we wait for realtime to bring it in.
      const existing = tiles.get(payload.id);
      if (existing) Object.assign(record, existing);
      // commitFreshTile was already called by the realtime handler — skip.
    } else {
      // Supabase demo (no Stripe) path
      const result = await dbInsertTile(record);
      if (result.error) {
        if (result.conflict) openConflictModal(payload.id);
        else                  openErrorModal("couldn't save your tile. try again in a moment.");
        return;
      }
      tiles.set(payload.id, record);
      commitFreshTile(record);
    }
  } else {
    // Local-only path
    tiles.set(payload.id, record);
    commitFreshTile(record);
    saveTiles();
  }

  selfClaimedIds.add(payload.id);
  saveSelfClaimedIds();
  addRecentClaim(record);

  const p = tilePriceCents(payload.x, payload.y, { audio_chip_id: payload.audio_chip_id, lock_passphrase: payload.lock_passphrase });
  openModal(`
    <div class="modal__ribbon">payment confirmed</div>
    <div class="payment">
      <div class="payment__ok">✓</div>
      <h2 class="payment__title">Your tile is permanent.</h2>
      <p class="mono mono--dim" style="margin:0 0 18px;">
        tile #${String(payload.id).padStart(4, '0')} · coord ${String(payload.x).padStart(2,'0')},${String(payload.y).padStart(2,'0')}
        ${record.tier ? ' · ' + record.tier : ''} · ${formatUsdCents(p.total)} ·
        ${new Date(record.timestamp).toISOString()}
      </p>
      <p class="modal__msg">&ldquo;${escapeHtml(record.text)}&rdquo;${record.emoji ? ' ' + escapeHtml(record.emoji) : ''}</p>
      <div class="modal__actions" style="justify-content:center;">
        <button class="btn" data-share="${payload.id}">share tile #${payload.id}</button>
        <button class="btn btn--ghost" data-close>admire the billboard</button>
      </div>
    </div>
  `);
  modalEl.querySelector('[data-share]')?.addEventListener('click', () => shareTile(record));
  pushLedger(record);
  refreshStats();
}

function openConflictModal(id) {
  openModal(`
    <div class="modal__ribbon">tile already taken</div>
    <h2 class="modal__heading" id="modal-title">Someone beat you to it.</h2>
    <p class="modal__msg">Tile #${id} was just claimed by someone else — even before your payment cleared. Their inscription now occupies the spot. Your card will not be charged.</p>
    <p class="mono mono--dim" style="margin:0 0 4px;">you'll see their tile light up in the live ledger on the way out.</p>
    <div class="modal__actions" style="justify-content:center; margin-top:18px;">
      <button class="btn" data-close>pick another tile</button>
    </div>
  `);
}

function openErrorModal(msg) {
  openModal(`
    <div class="modal__ribbon">network error</div>
    <h2 class="modal__heading" id="modal-title">Couldn't save your tile.</h2>
    <p class="modal__msg">${escapeHtml(msg)}</p>
    <div class="modal__actions" style="justify-content:center; margin-top:18px;">
      <button class="btn" data-close>try again</button>
    </div>
  `);
}

/* ---------- Share ---------- */
function shareTile(data) {
  const url = `${location.origin}${location.pathname}#tile-${data.id}`;
  const text = `I claimed tile #${data.id} on The Time Capsule Billboard: "${data.text.slice(0, 60)}${data.text.length > 60 ? '…' : ''}"`;
  const twitter = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  if (navigator.share) {
    navigator.share({ title: 'The Time Capsule Billboard', text, url }).catch(() => {
      window.open(twitter, '_blank', 'noopener');
    });
  } else {
    window.open(twitter, '_blank', 'noopener');
  }
  copyToClipboard(url);
  toast(`copied link to tile #${data.id}`);
}

/* ---------- Toast ---------- */
let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-visible'), 2400);
}

function copyToClipboard(text) {
  try { navigator.clipboard?.writeText(text); } catch (e) { /* older */ }
}

/* ---------- Stats ---------- */
const statFilled  = $('#stat-filled');
const statClaims  = $('#stat-claims');
const statRevenue = $('#stat-revenue');
const statUptime  = $('#stat-uptime');
const statLatest  = $('#stat-latest');

function computeStats() {
  const claims    = SUPABASE.enabled
    ? selfClaimedIds.size
    : Array.from(tiles.values()).filter(t => !t.isSeeded).length;
  // Mixed revenue: paid tiles + add-on surcharges. For mock/local mode we
  // can only approximate (single $3 base price); for shared mode we sum the
  // real addons_total_cents field.
  let revenue_cents = 0;
  if (SUPABASE.enabled) {
    for (const t of selfClaimedIds) {
      const r = tiles.get(t);
      if (r && Number.isFinite(r.amount_paid_proxy)) revenue_cents += r.amount_paid_proxy;
      else revenue_cents += BASE_CENTS;
    }
  } else {
    revenue_cents = claims * BASE_CENTS;
  }
  const available = Math.max(0, TOTAL_TILES - tiles.size);
  const lastClaim = recentClaims[0] || null;
  const lastAgo   = lastClaim ? relativeTime(Date.now() - lastClaim.timestamp) : '—';
  return {
    filled: tiles.size,
    claims,
    available,
    revenue: revenue_cents,
    lastNonSeeded: lastClaim,
    lastAgo,
  };
}

function refreshStats() {
  const s = computeStats();
  statFilled.textContent  = s.filled.toLocaleString();
  statClaims.textContent  = s.claims.toLocaleString();
  statRevenue.textContent = s.revenue >= 1000
    ? '$' + (s.revenue / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })
    : formatUsdCents(s.revenue);
  statLatest.textContent = s.lastNonSeeded
    ? `${s.lastNonSeeded.emoji ? s.lastNonSeeded.emoji + ' ' : ''}“${s.lastNonSeeded.text.slice(0, 60)}${s.lastNonSeeded.text.length > 60 ? '…' : ''}” · ${s.lastAgo}`
    : '—';
}

function relativeTime(ms) {
  if (ms < 1000) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24);
  return d + 'd ago';
}

let upSince;
function startUptime() {
  upSince = Date.now();
  setInterval(() => {
    const ms = Date.now() - upSince;
    const s = Math.floor(ms / 1000);
    const hh = String(Math.floor(s / 3600)).padStart(2, '0');
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    statUptime.textContent = `${hh}:${mm}:${ss}`;
  }, 1000);
}

/* ---------- Live ledger feed ---------- */
const ledgerEl = $('#ledger');

function pushLedger(record) {
  const iso = new Date(record.timestamp).toISOString().slice(11, 19) + ' UTC';
  const div = document.createElement('div');
  div.className = 'ledger__entry ledger__entry--live';
  div.innerHTML = `
    <span class="ledger__time">${iso}</span>
    <span class="ledger__tile">#${String(record.id).padStart(4, '0')}</span>
    <span class="ledger__msg">${escapeHtml(record.text)}</span>
  `;
  ledgerEl.prepend(div);
  setTimeout(() => div.classList.remove('ledger__entry--live'), 1400);
  while (ledgerEl.children.length > 40) ledgerEl.removeChild(ledgerEl.lastChild);
}

function seedLedger() {
  ledgerEl.innerHTML = '';
  const yours = SUPABASE.enabled
    ? Array.from(selfClaimedIds).map(id => tiles.get(id)).filter(Boolean)
    : Array.from(tiles.values()).filter(t => !t.isSeeded);
  yours.sort((a, b) => b.timestamp - a.timestamp);
  if (yours.length > 0) { yours.forEach(pushLedger); return; }
  const sample = Array.from(tiles.values())
    .filter(t => t.isSeeded)
    .sort(() => Math.random() - 0.5)
    .slice(0, 12);
  sample.forEach(t => {
    const isoDate = new Date(t.timestamp).toISOString().slice(11, 19) + ' UTC';
    const div = document.createElement('div');
    div.className = 'ledger__entry ledger__entry--pre';
    div.innerHTML = `
      <span class="ledger__time">${isoDate}</span>
      <span class="ledger__tile">#${String(t.id).padStart(4, '0')}</span>
      <span class="ledger__msg">${escapeHtml(t.text)}</span>
    `;
    ledgerEl.appendChild(div);
  });
}

/* ---------- Theme toggle ---------- */
const themeBtn = $('#theme-toggle');
themeBtn.addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('tcb.theme', next); } catch (_) {}
});
(function restoreTheme() {
  try {
    const saved = localStorage.getItem('tcb.theme');
    if (saved === 'dark' || saved === 'light') document.documentElement.setAttribute('data-theme', saved);
  } catch (_) {}
})();

/* ================================================
   Faction Wars — minimal v1 scaffolding.
   Modal: email magic-link sign-in via Supabase.
   Logged-in users see "create faction" + a roster list.
   Faction block-reservation UI is v2; this is plumbing.
   ================================================ */
async function openFactionModal() {
  const user = SUPABASE.auth.user;
  const isSignedIn = !!user;
  openModal(`
    <div class="modal__ribbon">faction mode</div>
    <h2 class="modal__heading" id="modal-title">Pool money with friends.</h2>
    <p class="modal__sub">a faction can claim a 5×5 block of tiles atomically — all-or-nothing, refunded if anyone grabbed one first.</p>

    ${isSignedIn ? `
      <p class="modal__msg">signed in as <strong>${escapeHtml(user.email || '(no email)')}</strong></p>
      <div class="field">
        <span class="field__label">
          <span>new faction name</span>
          <span class="field__count">/40</span>
        </span>
        <input class="field__input" name="faction_name" maxlength="40" placeholder="r/cool-tiles" required />
      </div>
      <div class="field">
        <span class="field__label">
          <span>description (optional)</span>
          <span class="field__count">/280</span>
        </span>
        <input class="field__input" name="faction_desc" maxlength="280" placeholder="a tiny adversarial patch on the billboard" />
      </div>
      <div class="field">
        <span class="field__label"><span>palette accent</span><span class="field__count">faction hue</span></span>
        <input class="field__input" name="faction_palette" maxlength="16" placeholder="#a45a76" />
      </div>
      <div class="modal__actions">
        <button type="button" class="btn btn--accent" id="faction-create-btn">create faction</button>
        <button type="button" class="btn btn--ghost" data-sign-out>sign out</button>
        <button type="button" class="btn btn--ghost" data-close>close</button>
      </div>
      <p class="mono mono--dim" style="margin-top:14px; font-size:0.78rem;">block reservation UI lands in v2 — until then, individual tile claims stay the primary path.</p>
    ` : `
      <p class="modal__msg">to form a faction you need an account. we send a one-time link to your inbox — no password, no tracking.</p>
      <div class="field">
        <span class="field__label"><span>your email</span><span class="field__count">magic link</span></span>
        <input class="field__input" type="email" name="email" maxlength="200" placeholder="you@example.com" required />
      </div>
      <div class="modal__actions">
        <button type="button" class="btn btn--accent" id="faction-signin-btn">send magic link</button>
        <button type="button" class="btn btn--ghost" data-close>cancel</button>
      </div>
      <p class="mono mono--dim" style="margin-top:14px; font-size:0.78rem;">the link expires in 60 minutes. we'll never email you again unless you ask.</p>
    `}
  `);

  if (isSignedIn) {
    modalEl.querySelector('#faction-create-btn')?.addEventListener('click', async () => {
      const name = modalEl.querySelector('[name="faction_name"]').value.trim();
      const desc = modalEl.querySelector('[name="faction_desc"]').value.trim();
      const pal  = modalEl.querySelector('[name="faction_palette"]').value.trim() || '#a45a76';
      if (!name) return toast('faction needs a name');
      try {
        const session = SUPABASE.auth.session;
        const res = await fetch('/.netlify/functions/faction-create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token || ''}`,
          },
          body: JSON.stringify({ name, description: desc, palette: pal }),
        });
        const body = await res.json();
        if (!res.ok) {
          toast(body.error || 'faction create failed');
          return;
        }
        toast(`faction "${body.name}" founded`);
        closeModal();
      } catch (e) {
        toast('network error');
      }
    });
    modalEl.querySelector('[data-sign-out]')?.addEventListener('click', async () => {
      await SUPABASE.client.auth.signOut();
      SUPABASE.auth.user = null;
      SUPABASE.auth.session = null;
      toast('signed out');
      closeModal();
    });
  } else {
    modalEl.querySelector('#faction-signin-btn')?.addEventListener('click', async () => {
      const email = modalEl.querySelector('[name="email"]').value.trim();
      if (!email) return shake(modalEl.querySelector('[name="email"]'));
      try {
        const { error } = await SUPABASE.client.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname },
        });
        if (error) { toast(error.message); return; }
        toast('magic link sent — check your inbox');
        closeModal();
      } catch (e) {
        toast('sign-in failed');
      }
    });
  }
}

/* ================================================
   Auth-confirm URL handler (?then= or hash magic-link returns)
   ================================================ */
async function handleMagicLinkReturn() {
  if (!SUPABASE.enabled) return;
  try {
    const { error } = await SUPABASE.client.auth.exchangeCodeForSession();
    if (error) console.warn('auth return:', error.message);
    const { data } = await SUPABASE.client.auth.getSession();
    SUPABASE.auth.session = data?.session || null;
    SUPABASE.auth.user    = data?.session?.user || null;
    if (SUPABASE.auth.user) toast(`signed in as ${SUPABASE.auth.user.email}`);
  } catch (e) { /* ignore */ }
}

/* ---------- Boot ---------- */
(async function init() {
  setBillboardLoading(true);
  loadSelfClaimedIds();

  let usingSupabase = false;
  try { usingSupabase = await initSupabase(); } catch (_) { usingSupabase = false; }

  if (usingSupabase) {
    archiveModeLabel('shared · realtime');
    try {
      await handleMagicLinkReturn();
      const remote = await dbLoadTiles();
      remote.forEach(t => tiles.set(t.id, t));
      if (tiles.size === 0) {
        const ok = await dbSeedArchiveIfEmpty();
        if (ok) {
          const refreshed = await dbLoadTiles();
          refreshed.forEach(t => tiles.set(t.id, t));
        }
      }
    } catch (e) {
      console.warn('[supabase] load failed; falling back to local seed', e);
      usingSupabase = false;
    }
    if (usingSupabase) {
      dbSubscribeInserts((tile) => {
        if (tiles.has(tile.id)) return;
        commitFreshTile(tile);
        pushLedger(tile);
        addRecentClaim(tile);
        refreshStats();
      });
    }
  } else {
    archiveModeLabel('local · this browser only');
    const stored = loadTiles();
    if (stored && stored.length) {
      starter.firstTimestamp = Math.min(...stored.map(t => t.timestamp));
      stored.forEach(t => tiles.set(t.id, t));
      seedIntoEmptyCells(makePRNG(0xfeedface), Math.round(TOTAL_TILES * SEED_PERCENT));
    } else {
      seedDeterministic(makePRNG(0xc0ffee));
      starter.firstTimestamp = Date.now();
    }
  }

  renderGrid();
  // Bulk commit (no fossilize flash on bulk re-render of seed/persisted tiles).
  tiles.forEach(commitTileToDOM);

  recentClaims.length = 0;
  Array.from(tiles.values())
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 50)
    .forEach(addRecentClaim);

  seedLedger();
  refreshStats();
  startUptime();
  setBillboardLoading(false);

  // Faction mode nav-button — only present when auth is wired (Supabase live).
  const factionBtn = document.getElementById('faction-btn');
  if (factionBtn) {
    factionBtn.addEventListener('click', () => openFactionModal());
    factionBtn.style.display = usingSupabase ? '' : 'none';
  }

  const m = location.hash.match(/^#tile-(\d+)$/);
  if (m) {
    const id = parseInt(m[1], 10);
    if (tiles.has(id)) {
      const t = tiles.get(id);
      if (t.lock_kind === 'passphrase') openLockedModal(t);
      else { openViewModal(t); if (t.audio_chip_id) playChip(t.audio_chip_id); }
    }
  }

  document.addEventListener('keydown', (e) => {
    if (modalRoot.classList.contains('is-open')) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      moveFocus(e.key);
    }
  });
})();

function moveFocus(key) {
  const focused = document.activeElement?.closest('.tile');
  if (!focused) {
    const first = grid.firstElementChild;
    if (first) first.focus();
    return;
  }
  const id = parseInt(focused.dataset.id, 10);
  let next = id;
  if (key === 'ArrowRight') next = (id % GRID_SIZE === GRID_SIZE - 1) ? id : id + 1;
  if (key === 'ArrowLeft')  next = (id % GRID_SIZE === 0) ? id : id - 1;
  if (key === 'ArrowDown')  next = Math.min(id + GRID_SIZE, TOTAL_TILES - 1);
  if (key === 'ArrowUp')    next = Math.max(id - GRID_SIZE, 0);
  const el = grid.querySelector(`.tile[data-id="${next}"]`);
  if (el) el.focus();
}
