import assert from "node:assert/strict";
import test from "node:test";

import { accessCodeFromCookie, hashAccessCode, reissuedAccessCookie } from "../lib/access-code.ts";

const request = new Request("http://shed.local/api/household/members/owner-1", { method: "PATCH" });
const secure = new Request("https://shed.local/api/household/members/owner-1", { method: "PATCH" });

test("reissuing your own code hands back a cookie carrying it", async () => {
  const code = "shed_new-code-for-the-owner";
  const cookie = reissuedAccessCookie(request, code, "owner-1", "owner-1");
  assert.ok(cookie, "the caller must be given the replacement code");
  // The cookie has to carry the same code the database was just updated to, or
  // the caller is signed out holding a code they never saw.
  assert.equal(accessCodeFromCookie(cookie), code);
  assert.equal(
    await hashAccessCode(accessCodeFromCookie(cookie) as string),
    await hashAccessCode(code),
    "the cookie must hash to the stored access_code_hash",
  );
});

test("reissuing someone else's code leaves your own session alone", () => {
  assert.equal(reissuedAccessCookie(request, "shed_code-for-a-keeper", "owner-1", "keeper-9"), null);
});

test("an update that reissues nothing sets no cookie", () => {
  assert.equal(reissuedAccessCookie(request, null, "owner-1", "owner-1"), null);
});

test("an unauthenticated caller is never handed a cookie", () => {
  assert.equal(reissuedAccessCookie(request, "shed_code", null, "owner-1"), null);
  assert.equal(reissuedAccessCookie(request, "shed_code", undefined, "owner-1"), null);
});

test("the cookie is HttpOnly, and Secure only over https", () => {
  const plain = reissuedAccessCookie(request, "shed_code", "owner-1", "owner-1") as string;
  assert.match(plain, /HttpOnly/);
  assert.ok(!plain.includes("Secure"), "a plain-http install must still receive a usable cookie");
  const overTls = reissuedAccessCookie(secure, "shed_code", "owner-1", "owner-1") as string;
  assert.match(overTls, /Secure/);
});
