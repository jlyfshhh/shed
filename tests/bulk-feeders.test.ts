import assert from "node:assert/strict";
import test from "node:test";
import { normalizeBulkFeeders } from "../lib/bulk-feeders.ts";

test("bulk feeder intake preserves individual whole-gram weights", () => {
  const batch = normalizeBulkFeeders({
    preySpecies: " rat ", sizeClass: " small ", weightsGrams: [40, "42", 59], notes: "shipment",
  }, "2026-08-01");
  assert.deepEqual(batch, {
    preySpecies: "rat", sizeClass: "small", weightsGrams: [40, 42, 59],
    addedOn: "2026-08-01", notes: "shipment",
  });
});

test("bulk feeder intake rejects empty, fractional, and oversized batches", () => {
  assert.throws(() => normalizeBulkFeeders({ preySpecies: "rat", sizeClass: "small", weightsGrams: [] }, "2026-08-01"), /at least one/);
  assert.throws(() => normalizeBulkFeeders({ preySpecies: "rat", sizeClass: "small", weightsGrams: [40.5] }, "2026-08-01"), /whole number/);
  assert.throws(() => normalizeBulkFeeders({ preySpecies: "rat", sizeClass: "small", weightsGrams: Array(501).fill(40) }, "2026-08-01"), /500/);
});
