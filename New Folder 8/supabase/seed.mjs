#!/usr/bin/env node
// =============================================================
// supabase/seed.mjs — one-shot admin tool to populate the
// Time Capsule Billboard archive with a deterministic set of
// ~1,500 pre-seeded tiles.
//
// How to run:
//   SUPABASE_URL=https://xxx.supabase.co \
//   SUPABASE_SERVICE_KEY=ey... \
//     node supabase/seed.mjs
//
// Uses the service_role key, which bypasses RLS. Safe because
// the deterministic PRNG guarantees the same output across runs,
// so concurrent runs would just overwrite each other with the
// same rows.
//
// No npm dependencies — uses bare Node 18+ fetch + the Supabase
// REST API directly (POST + Prefer: resolution=ignore-duplicates).
// =============================================================

const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('set SUPABASE_URL and SUPABASE_SERVICE_KEY in env');
  console.error('  find them at: supabase.com/dashboard → Project → Settings → API');
  process.exit(1);
}

// ---------------------------------------------------------------
// Same seed bank as the in-browser pre-seed, so on-disk rows
// match what the localStorage fallback would have shown.
// ---------------------------------------------------------------
const PINNED_MESSAGES = [
  'Hello from 2031, anyone reading this?',
  'i love you, please don\'t forget.',
  'mom i made it',
  'first day of the rest of everything',
  'still humming that song from august',
  'the cat is fine. the cat is fine.',
  'we met here',
  'do not be afraid of the next part',
  'buying bitcoin feels weird today',
  'it rained for nine days straight',
  '◡̈',
  '<— hello from the old internet',
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
  'still thinking about that band',
  'long way from the first commit',
  'wish you were here',
  'the building fell but i didn\'t',
  'going to sleep, will revive tomorrow',
  'i forgive myself for 2019',
  'monday feels like a color',
  'i was here. i meant it.',
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
  'til we meet',
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
  'i was here. i am here.',
  'greetings from a small apartment',
  'tell me about the weather in 2099',
  'remember: today is mostly fine',
  'it wasn\'t the last time',
  'the tomatoes finally grew',
  'tiny, electric, here',
  'goodnight moon',
];

const HANDLE_BANK = [
  'anon', 'a stranger', 'a kid from ohio', 'someone from tokyo',
  'a tired adult', 'the night shift', 'a florist', 'a librarian',
  'first-time buyer', 'a cat', 'a pigeon', 'a coder', 'a poet',
  'no one in particular', "someone's mom", 'a ghost', 'the rain',
];

// Deterministic PRNG (mulberry32) with fixed seed - same as the browser.
const SEED = 0xC0FFEE;
let state = SEED >>> 0;
function rng() {
  state = (state + 0x6D2B79F5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Timestamps span Jan 1 2026 → Dec 31 2026 (one year) so seeded
// tiles feel like captures from a real, ongoing moment.
const SEED_TS_BASE = Date.UTC(2026, 0, 1);
const SEED_TS_SPAN = 1000 * 60 * 60 * 24 * 365;

function extractEmoji(s) {
  const m = s.match(/\p{Extended_Pictographic}/u);
  return m ? m[0] : null;
}

// ---------------------------------------------------------------
// Generate the rows.
// ---------------------------------------------------------------
const TOTAL_TILES   = 10000;
const SEED_PERCENT  = 0.15;
const TARGET        = Math.round(TOTAL_TILES * SEED_PERCENT);
const rows          = [];
const seen          = new Set();

while (rows.length < TARGET) {
  const id = Math.floor(rng() * TOTAL_TILES);
  if (seen.has(id)) continue;
  seen.add(id);
  const text = PINNED_MESSAGES[Math.floor(rng() * PINNED_MESSAGES.length)];

  rows.push({
    id,
    x: id % 100,
    y: Math.floor(id / 100),
    text,
    emoji: extractEmoji(text),
    handle: rng() < 0.55 ? null : HANDLE_BANK[Math.floor(rng() * HANDLE_BANK.length)],
    timestamp: new Date(SEED_TS_BASE + Math.floor(rng() * SEED_TS_SPAN)).toISOString(),
    created_at: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------
// Insert in chunks (PostgREST has a soft URL/body limit on bulk).
// ---------------------------------------------------------------
async function upsertChunk(chunk) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tiles?on_conflict=id`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      // ignore-duplicates: if a row with that id already exists, skip
      // (don't overwrite the existing row; we'd rather keep the existing one).
      'Prefer': 'resolution=ignore-duplicates',
    },
    body: JSON.stringify(chunk),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return chunk.length;
}

const CHUNK = 500;
let total = 0;
console.log(`seeding ${rows.length} deterministic tiles in chunks of ${CHUNK}…`);
for (let i = 0; i < rows.length; i += CHUNK) {
  const slice = rows.slice(i, i + CHUNK);
  const written = await upsertChunk(slice);
  total += written;
  process.stdout.write(`\r  ${total}/${rows.length}`);
}
console.log(`\n✓ done — ${total} tiles written.`);
console.log(`url: ${SUPABASE_URL}`);
console.log(`next: open the app with config.js filled in — the board will populate.`);
