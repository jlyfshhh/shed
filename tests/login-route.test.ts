import assert from "node:assert/strict";
import test from "node:test";
import { hashAccessCode } from "../lib/access-code.ts";
import { ALL_CAPABILITIES } from "../lib/capabilities.ts";
import {
  handleLoginRequest,
  type LoginMember,
  type LoginStore,
} from "../lib/login-route.ts";
import {
  LoginThrottle,
  type ThrottleLimits,
  type TrustedProxyIpHeader,
} from "../lib/login-throttle.ts";

const limits = (maxFailures: number, windowMs = 10_000, blockMs = 5_000): ThrottleLimits => ({
  maxFailures,
  windowMs,
  blockMs,
});

async function loginHarness(options: {
  validCode?: string;
  member?: LoginMember;
  sourceLimit?: number;
  codeLimit?: number;
  globalLimit?: number;
  trustedProxyHeader?: TrustedProxyIpHeader;
} = {}) {
  let now = 0;
  let storesOpened = 0;
  const marked: Array<{ memberId: string; timestamp: string }> = [];
  const validHash = options.validCode ? await hashAccessCode(options.validCode) : null;
  const member = options.member ?? { id: "owner-1", displayName: "Head Keeper", role: "Owner" as const };
  const throttle = new LoginThrottle({
    source: limits(options.sourceLimit ?? 10),
    code: limits(options.codeLimit ?? 5),
    global: limits(options.globalLimit ?? 100, 10_000, 1_000),
    clock: () => now,
  });
  const store: LoginStore = {
    findActiveMember: async (candidateHash) => candidateHash === validHash ? member : null,
    markLogin: async (memberId, timestamp) => { marked.push({ memberId, timestamp }); },
  };

  return {
    throttle,
    marked,
    storesOpened: () => storesOpened,
    at: (value: number) => { now = value; },
    login: (accessCode: string, headers: Record<string, string> = {}) => handleLoginRequest(
      new Request("https://shed.example/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ accessCode }),
      }),
      {
        throttle,
        trustedProxyHeader: options.trustedProxyHeader,
        openStore: async () => { storesOpened += 1; return store; },
        now: () => new Date("2026-08-09T12:00:00.000Z"),
      },
    ),
  };
}

async function responseShape(response: Response) {
  return {
    status: response.status,
    body: await response.json(),
    cacheControl: response.headers.get("Cache-Control"),
    retryAfter: response.headers.get("Retry-After"),
    setCookie: response.headers.get("Set-Cookie"),
  };
}

test("direct LAN login ignores spoofed forwarding headers and creates no shared source bucket", async () => {
  const harness = await loginHarness({ sourceLimit: 1, codeLimit: 50, globalLimit: 50 });
  const spoofedHeaders: Array<Record<string, string>> = [
    { "CF-Connecting-IP": "203.0.113.1", "X-Forwarded-For": "192.0.2.1" },
    { "CF-Connecting-IP": "203.0.113.2", "X-Real-IP": "198.51.100.2" },
    { "X-Forwarded-For": "192.0.2.3, 10.0.0.1" },
  ];

  for (const [index, headers] of spoofedHeaders.entries()) {
    const response = await harness.login(`different-wrong-code-${index}`, headers);
    assert.equal(response.status, 401);
  }
  assert.deepEqual(harness.throttle.bucketCounts, { sources: 0, codes: 3 });
});

test("an explicitly trusted proxy header enables isolated source throttling", async () => {
  const harness = await loginHarness({
    sourceLimit: 2,
    codeLimit: 50,
    globalLimit: 50,
    trustedProxyHeader: "x-real-ip",
  });

  assert.equal((await harness.login("wrong-a", { "X-Real-IP": "192.0.2.10" })).status, 401);
  const blocked = await harness.login("wrong-b", { "X-Real-IP": "192.0.2.10" });
  assert.equal(blocked.status, 429);
  // Another address supplied by the configured proxy still has its own bucket.
  assert.equal((await harness.login("wrong-c", { "X-Real-IP": "192.0.2.11" })).status, 401);
});

test("repeated wrong code returns HTTP 429 with retry and no-store headers", async () => {
  const harness = await loginHarness({ sourceLimit: 50, codeLimit: 2, globalLimit: 50 });

  assert.equal((await harness.login("same-wrong-code")).status, 401);
  const blocked = await harness.login("same-wrong-code");
  assert.deepEqual(await responseShape(blocked), {
    status: 429,
    body: { error: "Too many sign-in attempts. Try again in 1 minute." },
    cacheControl: "no-store",
    retryAfter: "5",
    setCookie: null,
  });

  // Once blocked, another attempt is rejected before opening the member store.
  const before = harness.storesOpened();
  assert.equal((await harness.login("same-wrong-code")).status, 429);
  assert.equal(harness.storesOpened(), before);
});

test("valid login sets the session cookie and returns the Owner capability list", async () => {
  const validCode = "shed_valid-owner-code";
  const harness = await loginHarness({ validCode });

  const invalid = await responseShape(await harness.login("shed_not-valid"));
  assert.equal(invalid.status, 401);
  assert.equal(invalid.setCookie, null);

  const valid = await responseShape(await harness.login(validCode));
  assert.equal(valid.status, 200);
  assert.equal(valid.cacheControl, "no-store");
  assert.match(valid.setCookie ?? "", /^shed_access=shed_valid-owner-code;/);
  assert.match(valid.setCookie ?? "", /; HttpOnly;/);
  assert.match(valid.setCookie ?? "", /; Secure$/);
  assert.deepEqual(valid.body, {
    capabilities: ALL_CAPABILITIES,
    member: { id: "owner-1", displayName: "Head Keeper", role: "Owner" },
  });
  assert.deepEqual(harness.marked, [{ memberId: "owner-1", timestamp: "2026-08-09T12:00:00.000Z" }]);
});

test("different nonexistent codes have indistinguishable HTTP responses", async () => {
  const harness = await loginHarness({ codeLimit: 50, globalLimit: 50 });

  const first = await responseShape(await harness.login("shed_absent-one"));
  const second = await responseShape(await harness.login("shed_absent-two"));
  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    status: 401,
    body: { error: "That Shed invitation is invalid or inactive" },
    cacheControl: "no-store",
    retryAfter: null,
    setCookie: null,
  });
});
