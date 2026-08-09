import assert from "node:assert/strict";
import test from "node:test";
import { attributedTo } from "../lib/attribution.ts";

/**
 * `requireCapability` itself needs the Workers `env` binding, so the gate
 * behaviour is covered by the capability and route-policy tests. What is unit-testable —
 * and what actually caused the bug — is attribution when no member exists.
 */

test("attribution falls back to the role rather than writing undefined", () => {
  // The auth-off case: authorised, but nobody is signed in.
  assert.deepEqual(attributedTo(null), { id: null, name: "Head Keeper" });
});

test("a signed-in member is attributed to themselves", () => {
  const member = { id: "m-1", displayName: "Keeper One", role: "Zookeeper" as const, active: true, earningEnabled: true };
  assert.deepEqual(attributedTo(member), { id: "m-1", name: "Keeper One" });
});

test("attribution never yields undefined, which would land in the database", () => {
  for (const member of [null, { id: "x", displayName: "Y", role: "Owner" as const, active: true, earningEnabled: false }]) {
    const actor = attributedTo(member);
    assert.notEqual(actor.name, undefined);
    assert.ok(typeof actor.name === "string" && actor.name.length > 0);
    assert.ok(actor.id === null || typeof actor.id === "string");
  }
});
