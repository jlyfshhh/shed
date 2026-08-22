import assert from "node:assert/strict";
import test from "node:test";

import { hashAccessCode } from "../lib/access-code.ts";
import { reissueOwnerAccessCode, type RecoverOwnerStore } from "../lib/recover-owner.ts";

function store(owner: { id: string; displayName: string } | null) {
  const writes: Array<{ id: string; hash: string; timestamp: string }> = [];
  const impl: RecoverOwnerStore = {
    findOwner: async () => owner,
    reissue: async (id, hash, timestamp) => { writes.push({ id, hash, timestamp }); },
  };
  return { impl, writes };
}

test("a lost Head Keeper code is replaced with one that matches what is stored", async () => {
  const { impl, writes } = store({ id: "owner-1", displayName: "Head Keeper" });
  const result = await reissueOwnerAccessCode(impl, () => new Date("2026-08-21T12:00:00.000Z"));
  assert.ok(result, "an existing Head Keeper must be recoverable");
  assert.equal(result.owner.id, "owner-1");
  assert.match(result.accessCode, /^shed_/);
  assert.equal(writes.length, 1);
  // The whole point: the code handed back must hash to what sign-in will look up.
  assert.equal(writes[0].hash, await hashAccessCode(result.accessCode));
  assert.equal(writes[0].id, "owner-1");
  assert.equal(writes[0].timestamp, "2026-08-21T12:00:00.000Z");
});

test("each recovery issues a different code", async () => {
  const { impl } = store({ id: "owner-1", displayName: "Head Keeper" });
  const first = await reissueOwnerAccessCode(impl);
  const second = await reissueOwnerAccessCode(impl);
  assert.notEqual(first?.accessCode, second?.accessCode);
});

test("a household with no Head Keeper is reported, not invented", async () => {
  const { impl, writes } = store(null);
  assert.equal(await reissueOwnerAccessCode(impl), null);
  assert.equal(writes.length, 0, "nothing may be written when there is no owner");
});
