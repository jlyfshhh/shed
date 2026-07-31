import assert from "node:assert/strict";
import test from "node:test";
import { equipmentAgeDays, equipmentAgeLabel } from "../lib/equipment-age.ts";

test("equipment age is derived without storing a stale duration", () => {
  assert.equal(equipmentAgeDays("2026-07-01", "2026-07-31"), 30);
  assert.equal(equipmentAgeLabel(30), "4 weeks in use");
  assert.equal(equipmentAgeLabel(400), "13 months in use");
  assert.equal(equipmentAgeDays(null, "2026-07-31"), null);
});
