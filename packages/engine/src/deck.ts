import { createHash, randomBytes } from 'node:crypto';
import type { Card, DeckCommitment, Rank, Suit } from './types.js';

// ---------------------------------------------------------------------------
// Card constants
// ---------------------------------------------------------------------------
const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS: Suit[] = ['c', 'd', 'h', 's'];

export function buildFullDeck(): Card[] {
  const deck: Card[] = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      deck.push(`${rank}${suit}` as Card);
    }
  }
  return deck; // 52 cards
}

// ---------------------------------------------------------------------------
// Cryptographically secure RNG
// ---------------------------------------------------------------------------

/**
 * Returns a cryptographically random integer in [0, max).
 * Uses rejection sampling to eliminate modulo bias.
 */
export function secureRandomInt(max: number): number {
  if (max <= 0 || !Number.isInteger(max)) {
    throw new Error(`secureRandomInt: max must be a positive integer, got ${max}`);
  }
  if (max === 1) return 0;

  // Number of random bits needed
  const bytesNeeded = Math.ceil(Math.log2(max) / 8) + 1;
  const maxUnbiased = Math.floor(256 ** bytesNeeded / max) * max;

  let sample: number;
  do {
    const buf = randomBytes(bytesNeeded);
    sample = 0;
    for (const byte of buf) {
      sample = sample * 256 + byte;
    }
  } while (sample >= maxUnbiased);

  return sample % max;
}

// ---------------------------------------------------------------------------
// Fisher–Yates shuffle (in-place, secure RNG)
// ---------------------------------------------------------------------------
export function shuffleDeck(deck: Card[], rng: (max: number) => number = secureRandomInt): Card[] {
  const out = [...deck];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    // biome-ignore: standard swap
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Commit-reveal (provably-fair)
//
// Protocol:
//   1. Server generates serverSeed = randomBytes(32).
//   2. Server publishes commitment = SHA-256(serverSeed + shuffleIndex).
//   3. Client contributes clientSeed (arbitrary string, e.g. browser entropy).
//   4. Combined seed = SHA-256(serverSeed + clientSeed + shuffleIndex) is used
//      to deterministically produce the shuffle for verification.
//   5. After hand, server reveals serverSeed. Anyone can verify the shuffle.
// ---------------------------------------------------------------------------

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function generateServerSeed(): string {
  return randomBytes(32).toString('hex');
}

export function commitServerSeed(serverSeed: string, shuffleIndex: number): string {
  return sha256(`${serverSeed}:${shuffleIndex}`);
}

export function deriveShuffleSeed(
  serverSeed: string,
  clientSeed: string,
  shuffleIndex: number,
): string {
  return sha256(`${serverSeed}:${clientSeed}:${shuffleIndex}`);
}

/**
 * A seeded pseudo-random number generator derived from a hex seed string.
 * Used only for deterministic verification of a past shuffle.
 * NOT used for live play — live play uses secureRandomInt (OS entropy).
 *
 * Algorithm: counter-based stream from the seed.
 */
export function makeSeededRng(hexSeed: string): (max: number) => number {
  let counter = 0;
  return (max: number): number => {
    // Derive per-call bytes: SHA-256(seed + counter)
    const hash = createHash('sha256')
      .update(`${hexSeed}:${counter}`)
      .digest();
    counter++;

    // Read 4 bytes as uint32 big-endian
    const sample = hash.readUInt32BE(0);
    // Rejection-sample within the highest multiple of max ≤ 2^32
    const limit = Math.floor(0x1_0000_0000 / max) * max;
    if (sample >= limit) {
      // Recurse once; probability < 0.5, so expected iterations < 2
      return makeSeededRng(`${hexSeed}:retry:${counter}`)(max);
    }
    return sample % max;
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ShuffleResult {
  deck: Card[];
  commitment: DeckCommitment;
}

/**
 * Create a fresh shuffled deck for live play (server-side).
 * Returns the shuffled deck and the commitment to publish to clients.
 */
export function createShuffledDeck(clientSeed: string, shuffleIndex: number): ShuffleResult {
  const serverSeed = generateServerSeed();
  const serverSeedHash = commitServerSeed(serverSeed, shuffleIndex);

  // Live shuffle uses OS entropy, not the combined seed — the combined seed
  // is only for post-hand verification. This prevents a compromised client
  // from predicting the deck while still allowing verification after reveal.
  const deck = shuffleDeck(buildFullDeck());

  const commitment: DeckCommitment = {
    serverSeedHash,
    clientSeed,
    serverSeed, // kept server-side; only revealed after hand
    shuffleIndex,
  };

  return { deck, commitment };
}

/**
 * Verify a past shuffle given the revealed server seed.
 * Returns the deterministic deck order so anyone can audit.
 */
export function verifyShuffledDeck(
  serverSeed: string,
  clientSeed: string,
  shuffleIndex: number,
  publishedHash: string,
): { valid: boolean; deck: Card[] } {
  const expectedHash = commitServerSeed(serverSeed, shuffleIndex);
  if (expectedHash !== publishedHash) {
    return { valid: false, deck: [] };
  }

  const combinedSeed = deriveShuffleSeed(serverSeed, clientSeed, shuffleIndex);
  const rng = makeSeededRng(combinedSeed);
  const deck = shuffleDeck(buildFullDeck(), rng);

  return { valid: true, deck };
}
