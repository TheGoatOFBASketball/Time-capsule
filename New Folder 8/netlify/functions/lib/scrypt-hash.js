// =============================================================================
// netlify/functions/lib/scrypt-hash.js
//
//   Per-tile passphrase hashing using node:crypto (no npm bcrypt dep).
//
//   Storage format (set in `lock_hash` column):
//     "scrypt$N=32768,r=8,p=1$<salt-base64-urlsafe>$<hash-base64-urlsafe>"
//
//   Why scrypt:
//     • Built into Node — zero dependency surface.
//     • Memory-hard → resists GPU/ASIC brute force.
//     • Constant params let us tune cost once, then re-verify forever.
//
//   Used by:
//     • stripe-webhook.js     (hashes the buyer's plaintext passphrase at INSERT)
//     • unlock-tile.js        (re-derives from supplied guess + compares)
//
//   Note: Passphrases are NEVER stored in plaintext. The hash alone is
//   useless to a thief without the salt; the salt is also useless without
//   the algorithm parameters. We keep algorithm params embedded in the
//   stored string so future upgrades don't break old hashes.
// =============================================================================

import crypto from 'node:crypto';

const SCRYPT_N = 32768;     // CPU/memory cost — 2^15
const SCRYPT_r =     8;     // block size
const SCRYPT_p =     1;     // parallelization
const KEYLEN   =    32;     // 256-bit derived key
const SALT_LEN =    16;     // 128-bit salt

function generateSalt() {
  return crypto.randomBytes(SALT_LEN).toString('base64url');
}

function deriveHash(passphrase, saltB64) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      passphrase,
      Buffer.from(saltB64, 'base64url'),
      KEYLEN,
      { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p, maxmem: 64 * 1024 * 1024 },
      (err, derivedKey) => {
        if (err) return reject(err);
        resolve(derivedKey.toString('base64url'));
      }
    );
  });
}

// Async — produces a single string suitable for `tiles.lock_hash`.
// Pseudonym and salt are stored separately (lock_salt column).
export async function hashPassphrase(passphrase) {
  const salt = generateSalt();
  const hash = await deriveHash(passphrase, salt);
  return {
    salt,
    hash,
    algorithm: `scrypt$N=${SCRYPT_N},r=${SCRYPT_r},p=${SCRYPT_P}`,
  };
}

// Async — given a stored (salt, hash) + the user's supplied guess, returns
// true on match. Constant-time via crypto.timingSafeEqual.
export async function verifyPassphrase(passphrase, saltB64, expectedHashB64) {
  const candidate = await deriveHash(passphrase, saltB64);
  const a = Buffer.from(candidate, 'base64url');
  const b = Buffer.from(expectedHashB64, 'base64url');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Build the canonical `lock_hash` value that goes into the DB column.
// Format:  "scheme$salt$hash"  (-separated, base64url).
export async function buildLockHashField(passphrase) {
  const { salt, hash } = await hashPassphrase(passphrase);
  return {
    salt,
    field: `scrypt$${salt}$${hash}`,
  };
}
