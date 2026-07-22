// =============================================================================
// netlify/functions/lib/pricing.js
//
//   Shared price computation for single-tile and faction-block purchases.
//
//   Tier rules (kept in sync with script.js → pricingTier()):
//     • legendary  — fixed special coords (69,69 / 69,42 / 04,20 / 42,42 / 50,50)
//                   → 1.5x multiplier → +$1.50 surcharge
//     • corner     — 4 grid corners (0,0 / 0,99 / 99,0 / 99,99)
//                   → 1.25x multiplier → +$0.75
//     • prime      — Manhattan distance from center < 10
//                   → 1.10x multiplier → +$0.30
//     • common     — everything else (no surcharge)
//
//   Add-ons:
//     • audio     — chip id (catalog)  → +$1.00 flat
//     • lock      — passphrase only    → free (flag-only, server hashes later)
//
//   Output:  priceForTile returns
//     {
//       base_cents, tier_cents, audio_cents, lock_cents,
//       total_cents,
//       tier,                       // 'legendary' | 'corner' | 'prime' | null
//       line_items: [               // human-readable breakdown for Stripe description
//         { label: 'tier',          amount_cents: 150, detail: 'legendary @ (69,69)' },
//         { label: 'audio chip',    amount_cents: 100, detail: 'mario-coin' },
//         { label: 'lock',          amount_cents:   0, detail: 'passphrase' },
//       ],
//     }
//
//   Used by:
//     • create-payment-intent.js   (single + faction path)
//     • script.js                  (price preview only — server is authoritative)
// =============================================================================

const BASE_CENTS = 300;             // $3.00 common-tier base
const TIER_MULTIPLIER = {
  legendary: 1.50,
  corner:    1.25,
  prime:     1.10,
  common:    1.00,
};
const AUDIO_CENTS = 100;            // +$1.00
const LOCK_CENTS  =   0;            // free; flag only
const GRID_SIZE = 100;

const LEGENDARY = new Set([
  [69, 69], [69, 42], [4, 20], [42, 42], [50, 50],
]);
const CORNERS = new Set([
  [0, 0], [0, 99], [99, 0], [99, 99],
]);

function pricingTier(x, y) {
  if (LEGENDARY.has([x, y].join(','))) return 'legendary';
  if (CORNERS.has([x, y].join(',')))    return 'corner';
  const cx = 50, cy = 50;
  const d = Math.abs(x - cx) + Math.abs(y - cy);  // Manhattan distance
  if (d < 10)                               return 'prime';
  return null;
}

function tierBaseCents(tier) {
  const mult = TIER_MULTIPLIER[tier || 'common'] ?? 1.00;
  return Math.round(BASE_CENTS * mult);
}

function tierSurchargeCents(tier) {
  return tierBaseCents(tier) - BASE_CENTS;
}

// priceForTile({ x, y, audio_chip_id?, lock_kind? })
function priceForTile({ x, y, audio_chip_id, lock_kind }) {
  const tier = pricingTier(x, y);
  const tier_cents  = tierSurchargeCents(tier);
  const audio_cents = audio_chip_id ? AUDIO_CENTS : 0;
  const lock_cents  = (lock_kind === 'passphrase') ? LOCK_CENTS : 0;
  const base_cents  = BASE_CENTS;
  const total_cents = base_cents + tier_cents + audio_cents + lock_cents;

  const line_items = [];
  if (tier) {
    line_items.push({
      label: 'tier',
      amount_cents: tier_cents,
      detail: `${tier} @ (${x},${y})`,
    });
  }
  if (audio_chip_id) {
    line_items.push({
      label: 'audio chip',
      amount_cents: audio_cents,
      detail: String(audio_chip_id).slice(0, 32),
    });
  }
  if (lock_kind === 'passphrase') {
    line_items.push({
      label: 'lock',
      amount_cents: lock_cents,
      detail: 'passphrase',
    });
  }

  return {
    base_cents,
    tier_cents,
    audio_cents,
    lock_cents,
    total_cents,
    tier,
    line_items,
  };
}

// Build a Stripe `description` string out of a list of price entries.
function buildPaymentDescription(entries) {
  // Each line item: "<kind> · <amount>"  — for one tile
  // For a block: same, then a total summary
  const totalCents = entries.reduce((sum, e) => sum + e.total_cents, 0);
  if (entries.length === 1) {
    const e = entries[0];
    const sub = e.line_items.length === 0
      ? 'tile only'
      : e.line_items.map(li => `${li.label} ${formatUsd(li.amount_cents)}`).join(' · ');
    return `tile @ (${e.x},${e.y}) — ${sub}`;
  }
  // Block reservation
  const lines = [
    `faction block reservation · ${entries.length} tiles`,
    ...entries.map(e => `  • (${e.x},${e.y}) ${formatUsd(e.total_cents)}`),
  ];
  lines.push(`total: ${formatUsd(totalCents)}`);
  return lines.join('\n');
}

function formatUsd(cents) {
  if (cents === 0) return 'free';
  return '$' + (cents / 100).toFixed(2);
}

module.exports = {
  BASE_CENTS,
  AUDIO_CENTS,
  GRID_SIZE,
  pricingTier,
  priceForTile,
  buildPaymentDescription,
  formatUsd,
};
