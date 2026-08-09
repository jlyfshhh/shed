import assert from "node:assert/strict";
import test from "node:test";
import { hashAccessCode } from "../lib/access-code.ts";
import {
  accessCodeFingerprint,
  LoginThrottle,
  sourceKeyFromRequest,
  trustedProxyIpHeader,
  type ThrottleLimits,
  type ThrottleOptions,
} from "../lib/login-throttle.ts";

/**
 * The clock is injected everywhere below; nothing here sleeps. `at()` moves the
 * throttle's idea of "now" so blocks can be walked up to and past their edge.
 */
function harness(options: ThrottleOptions = {}) {
  let now = 0;
  const throttle = new LoginThrottle({
    source: limits(3, 1_000, 5_000),
    code: limits(2, 1_000, 5_000),
    global: limits(50, 10_000, 2_000),
    clock: () => now,
    ...options,
  });
  return { throttle, at: (value: number) => { now = value; } };
}

function limits(maxFailures: number, windowMs: number, blockMs: number): ThrottleLimits {
  return { maxFailures, windowMs, blockMs };
}

test("one attacker's wrong codes do not lock out the rest of the household", () => {
  const { throttle, at } = harness();
  const attacker = "203.0.113.9";

  at(0);
  assert.equal(throttle.fail({ source: attacker, codeFingerprint: "guess-1" }).allowed, true);
  at(10);
  assert.equal(throttle.fail({ source: attacker, codeFingerprint: "guess-2" }).allowed, true);
  at(20);
  const blocked = throttle.fail({ source: attacker, codeFingerprint: "guess-3" });

  assert.deepEqual(blocked, { allowed: false, retryAfterSeconds: 5 });
  assert.equal(throttle.check({ source: attacker, codeFingerprint: "guess-4" }).allowed, false);
  // The whole point of the change: a keeper on another phone is untouched.
  assert.deepEqual(
    throttle.check({ source: "192.168.9.20", codeFingerprint: "keeper-code" }),
    { allowed: true, retryAfterSeconds: 0 },
  );
});

test("direct requests have no shared source bucket", () => {
  const { throttle, at } = harness({ source: limits(1, 1_000, 5_000) });

  at(0);
  assert.equal(throttle.fail({ codeFingerprint: "first-device-typo" }).allowed, true);
  at(1);
  assert.equal(throttle.fail({ codeFingerprint: "second-device-typo" }).allowed, true);
  assert.equal(throttle.bucketCounts.sources, 0);
});

test("a source block reports its remaining time and clears on its own", () => {
  const { throttle, at } = harness();
  const source = "203.0.113.9";

  for (const [when, fingerprint] of [[0, "a"], [10, "b"], [20, "c"]] as const) {
    at(when);
    throttle.fail({ source, codeFingerprint: fingerprint });
  }

  at(4_020);
  assert.deepEqual(throttle.check({ source, codeFingerprint: "d" }), { allowed: false, retryAfterSeconds: 1 });
  at(5_020);
  assert.deepEqual(throttle.check({ source, codeFingerprint: "d" }), { allowed: true, retryAfterSeconds: 0 });
});

test("one code sprayed from many addresses runs out of attempts", () => {
  const { throttle, at } = harness();

  at(0);
  assert.equal(throttle.fail({ source: "198.51.100.1", codeFingerprint: "shared" }).allowed, true);
  at(10);
  const blocked = throttle.fail({ source: "198.51.100.2", codeFingerprint: "shared" });

  assert.deepEqual(blocked, { allowed: false, retryAfterSeconds: 5 });
  // A different address trying a different code is unaffected by either bucket.
  assert.equal(throttle.check({ source: "198.51.100.3", codeFingerprint: "other" }).allowed, true);
});

test("the global ceiling only trips far above any one source or code, and clears quickly", () => {
  const { throttle, at } = harness({
    source: limits(100, 1_000, 5_000),
    code: limits(100, 1_000, 5_000),
    global: limits(5, 10_000, 2_000),
  });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    at(attempt);
    assert.equal(throttle.fail({ source: `10.0.0.${attempt}`, codeFingerprint: `code-${attempt}` }).allowed, true);
  }
  at(4);
  assert.deepEqual(
    throttle.fail({ source: "10.0.0.4", codeFingerprint: "code-4" }),
    { allowed: false, retryAfterSeconds: 2 },
  );

  // It is a household-wide lockout, which is why its block is short.
  assert.equal(throttle.check({ source: "192.168.9.20", codeFingerprint: "keeper-code" }).allowed, false);
  at(2_004);
  assert.equal(throttle.check({ source: "192.168.9.20", codeFingerprint: "keeper-code" }).allowed, true);
});

test("a correct code clears its own buckets but not the global ceiling", () => {
  const { throttle, at } = harness({ global: limits(3, 10_000, 2_000) });
  const source = "192.168.9.20";

  at(0);
  throttle.fail({ source, codeFingerprint: "typo-1" });
  at(1);
  throttle.fail({ source, codeFingerprint: "typo-2" });
  at(2);
  throttle.succeed({ source, codeFingerprint: "typo-2" });

  at(3);
  const afterSuccess = throttle.fail({ source, codeFingerprint: "typo-3" });
  // The source bucket restarted, so only the global ceiling can be speaking here.
  assert.deepEqual(afterSuccess, { allowed: false, retryAfterSeconds: 2 });
});

test("bucket counts stay bounded no matter how many distinct keys arrive", () => {
  const { throttle, at } = harness({ maxBuckets: 8 });

  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    at(attempt);
    throttle.fail({ source: `10.1.${attempt >> 8}.${attempt & 0xff}`, codeFingerprint: `code-${attempt}` });
  }

  const counts = throttle.bucketCounts;
  assert.ok(counts.sources <= 8, `sources grew to ${counts.sources}`);
  assert.ok(counts.codes <= 8, `codes grew to ${counts.codes}`);
});

test("a flood of fresh keys cannot evict a live block", () => {
  const { throttle, at } = harness({
    maxBuckets: 4,
    source: limits(2, 1_000, 60_000),
    code: limits(100, 1_000, 5_000),
    global: limits(1_000, 100_000, 1_000),
  });
  const attacker = "203.0.113.9";

  at(0);
  throttle.fail({ source: attacker, codeFingerprint: "guess-1" });
  at(1);
  assert.equal(throttle.fail({ source: attacker, codeFingerprint: "guess-2" }).allowed, false);

  for (let attempt = 0; attempt < 200; attempt += 1) {
    at(10 + attempt);
    throttle.fail({ source: `10.2.${attempt >> 8}.${attempt & 0xff}`, codeFingerprint: `flood-${attempt}` });
  }

  at(500);
  assert.equal(throttle.check({ source: attacker, codeFingerprint: "guess-3" }).allowed, false);
});

test("a wrong code for a real keeper and a wrong code for nobody are treated identically", async () => {
  // The throttle is keyed on the submitted string, fingerprinted before any
  // lookup, so it cannot branch on whether that string belongs to anyone.
  const real = await accessCodeFingerprint("shed_this-one-belongs-to-a-keeper");
  const missing = await accessCodeFingerprint("shed_this-one-belongs-to-nobody");
  assert.notEqual(real, missing);

  const decisions = (fingerprint: string) => {
    const { throttle, at } = harness();
    return [0, 10, 20, 30].map((when) => {
      at(when);
      return throttle.fail({ source: "203.0.113.9", codeFingerprint: fingerprint });
    });
  };

  assert.deepEqual(decisions(real), decisions(missing));
});

test("the fingerprint is stable, distinguishing, and not the stored credential hash", async () => {
  const code = "shed_abc123";
  assert.equal(await accessCodeFingerprint(code), await accessCodeFingerprint(`  ${code}  `));
  assert.notEqual(await accessCodeFingerprint(code), await accessCodeFingerprint("shed_abc124"));
  // Storing the same digest the members table holds would make the throttle map
  // a second copy of the credential store.
  assert.notEqual(await accessCodeFingerprint(code), await hashAccessCode(code));
});

test("forwarding headers are ignored unless one is explicitly trusted", () => {
  const request = (headers: Record<string, string>) => new Request("https://shed.example/api/auth/login", { headers });
  const spoofed = request({
    "CF-Connecting-IP": "203.0.113.9",
    "X-Real-IP": "198.51.100.5",
    "X-Forwarded-For": "192.0.2.4, 10.0.0.1",
  });

  assert.equal(sourceKeyFromRequest(spoofed), undefined);
  assert.equal(sourceKeyFromRequest(spoofed, "cf-connecting-ip"), "203.0.113.9");
  assert.equal(sourceKeyFromRequest(spoofed, "x-real-ip"), "198.51.100.5");
  assert.equal(sourceKeyFromRequest(spoofed, "x-forwarded-for"), "192.0.2.4");
  assert.equal(sourceKeyFromRequest(request({ "X-Real-IP": "   " }), "x-real-ip"), undefined);
  assert.equal(sourceKeyFromRequest(request({ "CF-Connecting-IP": "a".repeat(500) }), "cf-connecting-ip")?.length, 64);
});

test("trusted proxy header configuration is a closed allowlist", () => {
  assert.equal(trustedProxyIpHeader(undefined), undefined);
  assert.equal(trustedProxyIpHeader(""), undefined);
  assert.equal(trustedProxyIpHeader(" CF-Connecting-IP "), "cf-connecting-ip");
  assert.equal(trustedProxyIpHeader("x-real-ip"), "x-real-ip");
  assert.equal(trustedProxyIpHeader("x-forwarded-for"), "x-forwarded-for");
  assert.equal(trustedProxyIpHeader("forwarded"), undefined);
  assert.equal(trustedProxyIpHeader("x-client-ip"), undefined);
});
