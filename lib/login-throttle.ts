/**
 * Sign-in throttling for Shed.
 *
 * The previous version kept one counter for the whole install: ten wrong codes
 * from anywhere blocked *everyone*, so a single stranger with a curl loop could
 * lock a family out of their own dashboard. Failures are now counted in three
 * independent scopes:
 *
 *   - per source (only when a trusted proxy supplies an address) — the
 *     attacker blocks themselves;
 *   - per code fingerprint (the exact string that was submitted) — one guessed
 *     code sprayed from many addresses still runs out of attempts;
 *   - one global ceiling, deliberately loose and with a short block, as a cap on
 *     total guess rate. It is the only scope that can still affect the whole
 *     household, so it sits far above anything a real household reaches.
 *
 * Both keyed scopes are keyed on attacker-controlled input, so their maps are
 * bounded with deterministic eviction — an unbounded map here would itself be
 * the denial of service we are fixing.
 *
 * Nothing here depends on whether the submitted code exists. The code scope is
 * keyed on a fingerprint of the submitted string, computed before any lookup, so
 * a wrong code for a real keeper and a wrong code for nobody take the identical
 * path and produce the identical answer.
 *
 * State is per process and does not survive a worker restart; see the notes on
 * `LoginThrottle` for why that is acceptable here.
 */

export type ThrottleDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export type ThrottleLimits = {
  maxFailures: number;
  windowMs: number;
  blockMs: number;
};

/** Bucket keys for one attempt. `codeFingerprint` is absent on a pre-parse check. */
export type ThrottleKeys = {
  /** Absent for a direct LAN request, whose peer address Fetch does not expose. */
  source?: string;
  codeFingerprint?: string;
};

export const TRUSTED_PROXY_IP_HEADERS = [
  "cf-connecting-ip",
  "x-real-ip",
  "x-forwarded-for",
] as const;

export type TrustedProxyIpHeader = (typeof TRUSTED_PROXY_IP_HEADERS)[number];

export type ThrottleOptions = {
  source?: ThrottleLimits;
  code?: ThrottleLimits;
  global?: ThrottleLimits;
  maxBuckets?: number;
  clock?: () => number;
};

const MINUTE = 60_000;

/**
 * Generous, because keepers in one house often share a router: on a LAN each
 * phone has its own address, but through a tunnel they arrive as one source.
 */
export const DEFAULT_SOURCE_LIMITS: ThrottleLimits = { maxFailures: 10, windowMs: 10 * MINUTE, blockMs: 15 * MINUTE };

/** Tighter: this counts repeats of one exact string, not a keeper's typos. */
export const DEFAULT_CODE_LIMITS: ThrottleLimits = { maxFailures: 5, windowMs: 10 * MINUTE, blockMs: 15 * MINUTE };

/**
 * The backstop. Its block is short on purpose — it *is* a household-wide
 * lockout, so it must clear quickly. Access codes are 24 random bytes, so this
 * is a cap on wasted work (a hash and a query per attempt), not on guessing.
 */
export const DEFAULT_GLOBAL_LIMITS: ThrottleLimits = { maxFailures: 120, windowMs: 10 * MINUTE, blockMs: MINUTE };

export const DEFAULT_MAX_BUCKETS = 512;

const GLOBAL_KEY = "all";

type Bucket = {
  failures: number;
  windowStartedAt: number;
  blockedUntil: number;
};

/** One keyed scope: a bounded map of buckets under a single set of limits. */
class ScopeCounter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly limits: ThrottleLimits;
  private readonly capacity: number;

  constructor(limits: ThrottleLimits, capacity: number) {
    this.limits = limits;
    this.capacity = Math.max(1, capacity);
  }

  get size(): number {
    return this.buckets.size;
  }

  /** Milliseconds left on `key`'s block, or 0 when it may attempt a sign-in. */
  retryAfterMs(key: string, now: number): number {
    const bucket = this.live(key, now);
    return bucket && bucket.blockedUntil > now ? bucket.blockedUntil - now : 0;
  }

  /** Record a failure. Returns the milliseconds the caller must now wait. */
  fail(key: string, now: number): number {
    const existing = this.live(key, now);
    if (existing && existing.blockedUntil > now) return existing.blockedUntil - now;

    let bucket = existing;
    if (!bucket) {
      this.makeRoom(now);
      bucket = { failures: 0, windowStartedAt: now, blockedUntil: 0 };
      this.buckets.set(key, bucket);
    }
    bucket.failures += 1;
    if (bucket.failures >= this.limits.maxFailures) {
      bucket.blockedUntil = now + this.limits.blockMs;
      return this.limits.blockMs;
    }
    return 0;
  }

  /** Forget `key` entirely — the credential it was counting turned out to be good. */
  forget(key: string): void {
    this.buckets.delete(key);
  }

  clear(): void {
    this.buckets.clear();
  }

  /**
   * The bucket for `key` if it still counts, dropping it if it does not. A block
   * that has run out is forgiven rather than resumed, so a keeper who waited is
   * not blocked again by their own history.
   */
  private live(key: string, now: number): Bucket | null {
    const bucket = this.buckets.get(key);
    if (!bucket) return null;
    if (bucket.blockedUntil > now) return bucket;
    if (bucket.blockedUntil > 0 || now - bucket.windowStartedAt >= this.limits.windowMs) {
      this.buckets.delete(key);
      return null;
    }
    return bucket;
  }

  /** When this bucket stops being worth remembering. */
  private expiresAt(bucket: Bucket): number {
    return Math.max(bucket.blockedUntil, bucket.windowStartedAt + this.limits.windowMs);
  }

  /**
   * Make one slot free, deterministically.
   *
   * Spent buckets go first; if every slot is live, the one that expires soonest
   * loses, ties broken by insertion order. A blocked bucket always outlives a
   * fresh one (blockMs >= windowMs), so flooding new keys cannot evict an active
   * block — an attacker would have to fill the whole map with blocks of their
   * own, which the global ceiling caps.
   */
  private makeRoom(now: number): void {
    if (this.buckets.size < this.capacity) return;
    for (const [key, bucket] of this.buckets) {
      if (this.expiresAt(bucket) <= now) this.buckets.delete(key);
    }
    while (this.buckets.size >= this.capacity) {
      let victim: string | null = null;
      let victimExpiry = Number.POSITIVE_INFINITY;
      for (const [key, bucket] of this.buckets) {
        const expiry = this.expiresAt(bucket);
        if (expiry < victimExpiry) {
          victim = key;
          victimExpiry = expiry;
        }
      }
      if (victim === null) return;
      this.buckets.delete(victim);
    }
  }
}

/**
 * Counts failed sign-ins across the three scopes.
 *
 * State lives in process memory, so a worker restart forgives every count. That
 * is a real weakness against an attacker who can cause restarts, but the trade
 * is deliberate: the alternative is a database write per failed attempt, which
 * hands an unauthenticated caller a write amplifier — a worse hole than the one
 * it closes. The credential is 24 random bytes, so the throttle exists to cap
 * wasted work, not to be the thing standing between a guesser and an account.
 */
export class LoginThrottle {
  private readonly sources: ScopeCounter;
  private readonly codes: ScopeCounter;
  private readonly everyone: ScopeCounter;
  private readonly clock: () => number;

  constructor(options: ThrottleOptions = {}) {
    const maxBuckets = options.maxBuckets ?? DEFAULT_MAX_BUCKETS;
    this.sources = new ScopeCounter(options.source ?? DEFAULT_SOURCE_LIMITS, maxBuckets);
    this.codes = new ScopeCounter(options.code ?? DEFAULT_CODE_LIMITS, maxBuckets);
    this.everyone = new ScopeCounter(options.global ?? DEFAULT_GLOBAL_LIMITS, 1);
    this.clock = options.clock ?? Date.now;
  }

  /** Bucket counts, for tests that assert the bound actually holds. */
  get bucketCounts(): { sources: number; codes: number } {
    return { sources: this.sources.size, codes: this.codes.size };
  }

  check(keys: ThrottleKeys): ThrottleDecision {
    const now = this.clock();
    const waits = [this.everyone.retryAfterMs(GLOBAL_KEY, now)];
    if (keys.source) waits.push(this.sources.retryAfterMs(keys.source, now));
    if (keys.codeFingerprint) waits.push(this.codes.retryAfterMs(keys.codeFingerprint, now));
    return decision(Math.max(...waits));
  }

  /**
   * Record a wrong code. Every scope is charged, so a request that trips one
   * limit still counts towards the others.
   */
  fail(keys: ThrottleKeys): ThrottleDecision {
    const now = this.clock();
    const waits = [this.everyone.fail(GLOBAL_KEY, now)];
    if (keys.source) waits.push(this.sources.fail(keys.source, now));
    if (keys.codeFingerprint) waits.push(this.codes.fail(keys.codeFingerprint, now));
    return decision(Math.max(...waits));
  }

  /**
   * A correct code clears the scopes it can vouch for. The global ceiling is
   * left alone: one keeper signing in says nothing about a distributed flood,
   * and clearing it would hand an attacker who holds any valid code a reset.
   */
  succeed(keys: ThrottleKeys): void {
    if (keys.source) this.sources.forget(keys.source);
    if (keys.codeFingerprint) this.codes.forget(keys.codeFingerprint);
  }

  reset(): void {
    this.sources.clear();
    this.codes.clear();
    this.everyone.clear();
  }
}

function decision(waitMs: number): ThrottleDecision {
  return waitMs > 0
    ? { allowed: false, retryAfterSeconds: Math.ceil(waitMs / 1000) }
    : { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Which caller this is, for the per-source bucket.
 *
 * A Fetch `Request` does not expose the direct TCP peer. Every forwarding
 * header is caller-controlled unless the origin is reachable only through a
 * proxy that overwrites that exact header. Direct LAN mode therefore passes no
 * trusted header and gets no source key: it uses the per-code and short global
 * ceilings without putting the whole family in one fake `unknown` bucket.
 */
export function sourceKeyFromRequest(
  request: Request,
  trustedHeader?: TrustedProxyIpHeader,
): string | undefined {
  if (!trustedHeader) return undefined;
  const raw = request.headers.get(trustedHeader) ?? "";
  const candidate = trustedHeader === "x-forwarded-for" ? raw.split(",")[0] : raw;
  const trimmed = candidate.trim().toLowerCase();
  return trimmed ? trimmed.slice(0, 64) : undefined;
}

/** Parse the one explicitly trusted proxy header; invalid values fail closed. */
export function trustedProxyIpHeader(value: string | undefined): TrustedProxyIpHeader | undefined {
  const normalized = value?.trim().toLowerCase();
  return TRUSTED_PROXY_IP_HEADERS.find((header) => header === normalized);
}

let fingerprintSalt: Uint8Array | null = null;

/**
 * Bucket key for "this exact string was tried again".
 *
 * Salted per process on purpose. An unsalted SHA-256 of the code is exactly what
 * the members table stores, so the throttle map would otherwise be a second copy
 * of the credential store — and a fingerprint that means something outside this
 * process is a fingerprint an attacker can pre-compute to confirm a guess.
 */
export async function accessCodeFingerprint(code: string): Promise<string> {
  if (!fingerprintSalt) {
    fingerprintSalt = new Uint8Array(16);
    crypto.getRandomValues(fingerprintSalt);
  }
  const encoded = new TextEncoder().encode(code.trim());
  const salted = new Uint8Array(fingerprintSalt.length + encoded.length);
  salted.set(fingerprintSalt, 0);
  salted.set(encoded, fingerprintSalt.length);
  const digest = await crypto.subtle.digest("SHA-256", salted);
  // Half the digest is plenty to separate buckets and leaks less if it escapes.
  return [...new Uint8Array(digest).subarray(0, 16)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const loginThrottle = new LoginThrottle();
