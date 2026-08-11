import assert from "node:assert/strict";
import test from "node:test";
import {
  planHouseholdProfiles,
  prepareLightingPlanSheets,
  restoreWithStagedLightingSheets,
  supersededLightingSheetKeys,
  type RestoreObjectStore,
} from "../lib/portable-restore.ts";

const pdfBytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);
const pdfBase64 = Buffer.from(pdfBytes).toString("base64");

const prepared = () => prepareLightingPlanSheets([
  { planId: "plan-1", name: "setup.pdf", dataBase64: pdfBase64 },
]);

test("household profile changes are planned without mutating storage", () => {
  let id = 0;
  const plan = planHouseholdProfiles([
    { id: "old-owner", display_name: "Former Owner", role: "Owner", earning_enabled: 1 },
    { id: "new-keeper", display_name: "  Sample   Keeper ", role: "Zookeeper", earning_enabled: 1 },
  ], [
    { id: "current-owner", displayName: "Current Owner", role: "Owner" },
  ], {
    now: () => "2026-08-11T12:00:00.000Z",
    randomId: () => `random-${++id}`,
  });

  assert.equal(plan.memberIds.get("old-owner"), "current-owner");
  assert.equal(plan.memberIds.get("new-keeper"), "new-keeper");
  assert.deepEqual(plan.operations.map((operation) => operation.kind), ["updateEarning", "insert", "updateEarning"]);
  const insert = plan.operations[1];
  assert.equal(insert?.kind, "insert");
  if (insert?.kind === "insert") {
    assert.equal(insert.displayName, "Sample Keeper");
    assert.equal(insert.accessCodeHash, "restored-disabled:random-1");
  }
});

test("lighting sheets use byte-detected MIME instead of trusting metadata", () => {
  const [sheet] = prepareLightingPlanSheets([
    { planId: "plan-1", name: "setup", dataBase64: pdfBase64 },
  ]);
  assert.equal(sheet?.mime, "application/pdf");
  assert.deepEqual(sheet?.bytes, pdfBytes);
});

test("a duplicate lighting-plan attachment is rejected defensively", () => {
  assert.throws(() => prepareLightingPlanSheets([
    { planId: "plan-1", dataBase64: pdfBase64 },
    { planId: "plan-1", dataBase64: pdfBase64 },
  ]), /more than one attachment/);
});

test("objects stage before the atomic commit and obsolete cleanup follows it", async () => {
  const events: string[] = [];
  const store: RestoreObjectStore = {
    async put(key, _bytes, options) {
      events.push(`put:${key}:${options.httpMetadata.contentType}`);
    },
    async delete(keys) {
      events.push(`delete:${(Array.isArray(keys) ? keys : [keys]).join(",")}`);
    },
  };

  const result = await restoreWithStagedLightingSheets({
    sheets: prepared(),
    store,
    makeKey: () => "staged-key",
    commit: async (staged) => {
      events.push(`commit:${staged.get("plan-1")?.key}`);
      return "committed";
    },
    cleanupSuperseded: async () => {
      events.push("cleanup-old");
    },
  });

  assert.equal(result, "committed");
  assert.deepEqual(events, [
    "put:staged-key:application/pdf",
    "commit:staged-key",
    "cleanup-old",
  ]);
});

test("a staging failure removes only objects uploaded during this attempt", async () => {
  const events: string[] = [];
  let putCount = 0;
  const sheets = [...prepared(), { ...prepared()[0]!, planId: "plan-2" }];
  const store: RestoreObjectStore = {
    async put(key) {
      events.push(`put:${key}`);
      putCount += 1;
      if (putCount === 2) throw new Error("R2 unavailable");
    },
    async delete(keys) {
      events.push(`delete:${(Array.isArray(keys) ? keys : [keys]).join(",")}`);
    },
  };

  await assert.rejects(restoreWithStagedLightingSheets({
    sheets,
    store,
    makeKey: (sheet) => `staged-${sheet.planId}`,
    commit: async () => {
      events.push("commit");
    },
    cleanupSuperseded: async () => {
      events.push("cleanup-old");
    },
  }), /R2 unavailable/);

  assert.deepEqual(events, ["put:staged-plan-1", "put:staged-plan-2", "delete:staged-plan-1"]);
});

test("a failed D1 batch rolls back staged objects and never cleans old files", async () => {
  const events: string[] = [];
  const store: RestoreObjectStore = {
    async put(key) {
      events.push(`put:${key}`);
    },
    async delete(keys) {
      events.push(`delete:${(Array.isArray(keys) ? keys : [keys]).join(",")}`);
    },
  };

  await assert.rejects(restoreWithStagedLightingSheets({
    sheets: prepared(),
    store,
    makeKey: () => "staged-key",
    commit: async () => {
      events.push("commit");
      throw new Error("D1 batch failed");
    },
    cleanupSuperseded: async () => {
      events.push("cleanup-old");
    },
  }), /D1 batch failed/);

  assert.deepEqual(events, ["put:staged-key", "commit", "delete:staged-key"]);
});

test("post-commit cleanup failure is reported but cannot turn success into failure", async () => {
  const cleanupErrors: string[] = [];
  const store: RestoreObjectStore = {
    async put() {},
    async delete() {},
  };
  const result = await restoreWithStagedLightingSheets({
    sheets: prepared(),
    store,
    commit: async () => "saved",
    cleanupSuperseded: async () => {
      throw new Error("cleanup unavailable");
    },
    onCleanupError: (error, phase) => cleanupErrors.push(`${phase}:${String(error)}`),
  });
  assert.equal(result, "saved");
  assert.match(cleanupErrors[0] ?? "", /^post-commit:Error: cleanup unavailable$/);
});

test("only affected, no-longer-referenced old keys are removed", () => {
  const previous = [
    { id: "plan-1", key: "old-1" },
    { id: "plan-2", key: "shared" },
    { id: "plan-3", key: "old-3" },
  ];
  assert.deepEqual(
    supersededLightingSheetKeys(previous, new Set(["shared", "new-1"]), "merge", new Set(["plan-1", "plan-2"])),
    ["old-1"],
  );
  assert.deepEqual(
    supersededLightingSheetKeys(previous, new Set(["shared"]), "replace", new Set()),
    ["old-1", "old-3"],
  );
});
