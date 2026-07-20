import assert from "node:assert/strict";
import test from "node:test";
import { feederInventorySeed } from "../lib/feeder-inventory.ts";

test("reported rat inventory is represented as uniquely identified weighed items", () => {
  assert.equal(feederInventorySeed.length, 37);
  assert.equal(new Set(feederInventorySeed.map((row) => row.id)).size, 37);
  assert.deepEqual(
    Object.fromEntries(
      ["pup", "weaned", "small"].map((sizeClass) => [
        sizeClass,
        feederInventorySeed.filter((row) => row.sizeClass === sizeClass).length,
      ]),
    ),
    { pup: 9, weaned: 17, small: 11 },
  );
});
