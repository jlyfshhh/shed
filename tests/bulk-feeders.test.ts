import assert from "node:assert/strict";
import test from "node:test";
import { normalizeBulkFeeders } from "../lib/bulk-feeders.ts";

test("bulk feeder intake is a count and a size class", () => {
  const batch = normalizeBulkFeeders({
    preySpecies: " rat ", sizeClass: " small ", count: "20", notes: "shipment",
  }, "2026-08-01");
  assert.deepEqual(batch, {
    preySpecies: "rat", sizeClass: "small", count: 20,
    addedOn: "2026-08-01", notes: "shipment",
  });
});

test("intake rejects a missing, fractional, or oversized count", () => {
  const base = { preySpecies: "rat", sizeClass: "small" };
  assert.throws(() => normalizeBulkFeeders({ ...base }, "2026-08-01"), /whole number/);
  assert.throws(() => normalizeBulkFeeders({ ...base, count: 0 }, "2026-08-01"), /whole number/);
  assert.throws(() => normalizeBulkFeeders({ ...base, count: 2.5 }, "2026-08-01"), /whole number/);
  assert.throws(() => normalizeBulkFeeders({ ...base, count: 501 }, "2026-08-01"), /whole number/);
});

test("species and size class are still required, because they are what identifies a feeder", () => {
  assert.throws(() => normalizeBulkFeeders({ sizeClass: "small", count: 5 }, "2026-08-01"), /Prey species/);
  assert.throws(() => normalizeBulkFeeders({ preySpecies: "rat", count: 5 }, "2026-08-01"), /Size class/);
});

test("the added date defaults to today and must be a calendar date", () => {
  const batch = normalizeBulkFeeders({ preySpecies: "rat", sizeClass: "small", count: 3 }, "2026-08-17");
  assert.equal(batch.addedOn, "2026-08-17");
  assert.throws(
    () => normalizeBulkFeeders({ preySpecies: "rat", sizeClass: "small", count: 3, addedOn: "17/08/2026" }, "2026-08-17"),
    /YYYY-MM-DD/,
  );
});
