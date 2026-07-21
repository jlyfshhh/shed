import assert from "node:assert/strict";
import test from "node:test";
import { normalizedEmptyValue } from "../lib/manage-values.ts";

test("required defaulted text fields remain empty strings instead of becoming null", () => {
  assert.equal(normalizedEmptyValue("animal", "location"), "");
  assert.equal(normalizedEmptyValue("schedule", "details"), "");
});

test("optional empty management fields remain nullable", () => {
  assert.equal(normalizedEmptyValue("animal", "notes"), null);
  assert.equal(normalizedEmptyValue("schedule", "endDate"), null);
});
