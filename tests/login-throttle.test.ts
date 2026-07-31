import assert from "node:assert/strict";
import test from "node:test";
import { LoginThrottle } from "../lib/login-throttle.ts";

test("blocks after the configured number of failures and reports a retry delay", () => {
  const throttle = new LoginThrottle(3, 1_000, 5_000);
  assert.equal(throttle.fail(100).allowed, true);
  assert.equal(throttle.fail(200).allowed, true);
  assert.deepEqual(throttle.fail(300), { allowed: false, retryAfterSeconds: 5 });
  assert.deepEqual(throttle.check(1_300), { allowed: false, retryAfterSeconds: 4 });
  assert.equal(throttle.check(5_300).allowed, true);
});

test("a successful login and an expired attempt window reset failures", () => {
  const throttle = new LoginThrottle(2, 1_000, 5_000);
  throttle.fail(100);
  throttle.success();
  assert.equal(throttle.fail(200).allowed, true);
  assert.equal(throttle.check(1_300).allowed, true);
  assert.equal(throttle.fail(1_300).allowed, true);
});
