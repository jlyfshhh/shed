import assert from "node:assert/strict";
import test from "node:test";

import {
  accessCodeFromCookie,
  accessCookie,
  createAccessCode,
  expiredAccessCookie,
  hashAccessCode,
} from "../lib/access-code.ts";

test("member access codes are unique, opaque, and hash deterministically", async () => {
  const first = createAccessCode();
  const second = createAccessCode();
  assert.match(first, /^shed_[A-Za-z0-9_-]{32}$/);
  assert.notEqual(first, second);
  assert.equal((await hashAccessCode(first)).length, 64);
  assert.equal(await hashAccessCode(` ${first} `), await hashAccessCode(first));
});

test("access cookie is HttpOnly, readable by the server, and expirable", () => {
  const code = createAccessCode();
  const cookie = accessCookie(code, new Request("http://shed.local/api/auth/login"));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.doesNotMatch(cookie, /; Secure/);
  assert.equal(accessCodeFromCookie(`other=x; ${cookie.split(";")[0]}`), code);
  assert.match(expiredAccessCookie(), /Max-Age=0/);
});
