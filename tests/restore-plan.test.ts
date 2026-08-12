import assert from "node:assert/strict";
import test from "node:test";
import { MAX_ATTACHMENT_BYTES, MAX_ROWS_PER_RESOURCE, validateBundle } from "../lib/restore-plan.ts";

const b64 = (bytes: number[] | Uint8Array) => Buffer.from(Uint8Array.from(bytes)).toString("base64");
const PDF = b64([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, ...new Array(32).fill(0)]);

const bundle = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 8,
  animals: [{ id: "a1", name: "Resident" }],
  enclosures: [{ id: "e1", name: "Tank" }],
  lightingPlans: [{ id: "p1", animal_id: "a1" }],
  ...over,
});

test("a sound bundle passes and is counted", () => {
  const plan = validateBundle(bundle());
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.counts.animals, 1);
});

test("a row missing its key is caught before anything is deleted", () => {
  // The exact shape that used to survive validation, delete the database, and
  // then throw part way through the inserts.
  const plan = validateBundle(bundle({ animals: [{ id: "a1" }, { name: "no id" }] }));
  assert.equal(plan.errors.length, 1);
  assert.match(plan.errors[0], /animals\[1\] has no id/);
});

test("duplicate keys are reported rather than silently overwriting", () => {
  const plan = validateBundle(bundle({ animals: [{ id: "a1" }, { id: "a1" }] }));
  assert.match(plan.errors.join(" "), /more than once/);
});

test("completion outcomes are limited to done and refused", () => {
  assert.deepEqual(
    validateBundle(bundle({ husbandryEvents: [{ id: "event-1", outcome: "refused" }] })).errors,
    [],
  );
  assert.match(
    validateBundle(bundle({ husbandryEvents: [{ id: "event-1", outcome: "maybe" }] })).errors.join(" "),
    /invalid outcome/,
  );
});

test("a resource that is not a list is refused", () => {
  assert.match(validateBundle(bundle({ animals: "everything" })).errors.join(" "), /should be a list/);
  assert.match(validateBundle(bundle({ animals: [42] })).errors.join(" "), /is not an object/);
});

test("absurd row counts are refused before they are processed", () => {
  const many = new Array(MAX_ROWS_PER_RESOURCE + 1).fill({ id: "x" });
  assert.match(validateBundle(bundle({ animals: many })).errors.join(" "), /more than the/);
});

test("an attachment claiming to be a PDF but carrying HTML is refused", () => {
  const html = b64([...new TextEncoder().encode("<html><script>alert(1)</script></html>")]);
  const plan = validateBundle(bundle({
    lightingPlanSheets: [{ planId: "p1", name: "evil.pdf", type: "application/pdf", dataBase64: html }],
  }));
  assert.equal(plan.errors.length, 1);
  assert.match(plan.errors[0], /not a JPEG, PNG, WebP, or PDF/);
});

test("a genuine PDF attachment is accepted", () => {
  const plan = validateBundle(bundle({
    lightingPlanSheets: [{ planId: "p1", name: "plan.pdf", type: "application/pdf", dataBase64: PDF }],
  }));
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.counts.lightingPlanSheets, 1);
});

test("an attachment for a plan not in the bundle is refused", () => {
  // Otherwise the restore writes a file that nothing references.
  const plan = validateBundle(bundle({
    lightingPlanSheets: [{ planId: "nope", name: "plan.pdf", type: "application/pdf", dataBase64: PDF }],
  }));
  assert.match(plan.errors.join(" "), /which is not in this backup/);
});

test("a lighting plan cannot carry two attachment payloads", () => {
  const plan = validateBundle(bundle({
    lightingPlanSheets: [
      { planId: "p1", name: "one.pdf", type: "application/pdf", dataBase64: PDF },
      { planId: "p1", name: "two.pdf", type: "application/pdf", dataBase64: PDF },
    ],
  }));
  assert.match(plan.errors.join(" "), /more than one attachment/);
});

test("malformed and oversized attachments are refused", () => {
  assert.match(
    validateBundle(bundle({ lightingPlanSheets: [{ planId: "p1", dataBase64: "!!!not base64!!!" }] })).errors.join(" "),
    /valid base64|missing its plan id or contents/,
  );
  const huge = b64([0x25, 0x50, 0x44, 0x46, 0x2d, ...new Array(MAX_ATTACHMENT_BYTES).fill(0)]);
  assert.match(
    validateBundle(bundle({ lightingPlanSheets: [{ planId: "p1", type: "application/pdf", dataBase64: huge }] })).errors.join(" "),
    /larger than/,
  );
});

test("every problem is reported at once, not one per attempt", () => {
  // A keeper fixing a bad export should see the whole list, not discover the
  // next fault only after correcting the previous one.
  const plan = validateBundle(bundle({
    animals: [{ name: "one" }, { name: "two" }, { name: "three" }],
  }));
  assert.equal(plan.errors.length, 3);
});
