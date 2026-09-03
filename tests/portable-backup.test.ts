import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKUP_SCHEMA_VERSION,
  matchingExistingMember,
  PORTABLE_APP_SETTING_KEYS,
  PORTABLE_REPLACE_DELETE_ORDER,
  PORTABLE_RESOURCES,
  remapMemberReferences,
} from "../lib/portable-backup.ts";

test("schema 16 carries feeders, allowance, lighting imports, sheds, payouts, care-baseline data, grouped plans, and week intervals", () => {
  assert.equal(BACKUP_SCHEMA_VERSION, 16);
  // A fortnightly plan restored as weekly would silently double how often an
  // animal is dusted or fed. Same shape of loss as grace_days before it.
  assert.ok(PORTABLE_RESOURCES.careSchedules.columns.includes("week_interval"));
  // A plan covering several animals keeps that list in one column. Leaving it
  // out of the manifest would silently ungroup every plan on restore, which is
  // the same shape of loss that dropped grace_days and recorded_at before.
  assert.ok(PORTABLE_RESOURCES.careSchedules.columns.includes("animal_ids_json"));
  assert.ok(PORTABLE_RESOURCES.animalPhotos.columns.includes("data"));
  assert.equal(PORTABLE_RESOURCES.animalPhotos.key, "animal_id");
  assert.ok(PORTABLE_RESOURCES.careSchedules.columns.includes("prey_size_class"));
  assert.ok(PORTABLE_RESOURCES.careSchedules.columns.includes("reward_cents"));
  assert.ok(PORTABLE_RESOURCES.careTasks.columns.includes("missed_at"));
  assert.ok(PORTABLE_RESOURCES.husbandryEvents.columns.includes("reward_cents"));
  assert.deepEqual(PORTABLE_RESOURCES.rewardPayouts.columns, [
    "id", "member_id", "amount_cents", "note", "paid_at", "paid_by_member_id", "paid_by_name",
  ]);
  assert.ok(PORTABLE_RESOURCES.lightingPlans.columns.includes("plan_sheet_key"));
  assert.ok(PORTABLE_RESOURCES.lightingPlans.columns.includes("source_snapshot_json"));
  assert.ok(PORTABLE_RESOURCES.equipment.columns.includes("source_ref"));
  assert.ok(PORTABLE_RESOURCES.lightingPlanFixtures.columns.includes("equipment_id"));
  assert.ok(PORTABLE_RESOURCES.lightingPlanFixtures.columns.includes("source_ref"));
  assert.ok(PORTABLE_RESOURCES.lightingMeasurements.columns.includes("measured_by_member_id"));
  assert.ok(PORTABLE_RESOURCES.shedEvents.columns.includes("quality"));
  assert.deepEqual(PORTABLE_APP_SETTING_KEYS, ["default_reward_cents", "care_start_date"]);
});

test("replace restore clears every portable table exactly once", () => {
  const portableTables = Object.values(PORTABLE_RESOURCES)
    .map((definition) => definition.table)
    .filter((table) => table !== "app_settings")
    .sort();
  assert.deepEqual([...PORTABLE_REPLACE_DELETE_ORDER].sort(), portableTables);
  assert.equal(new Set(PORTABLE_REPLACE_DELETE_ORDER).size, PORTABLE_REPLACE_DELETE_ORDER.length);
});

test("restored attribution follows the matching household profile", () => {
  const memberIds = new Map([["old-keeper", "new-keeper"], ["old-owner", "new-owner"]]);
  assert.deepEqual(
    remapMemberReferences("husbandryEvents", {
      id: "event-1",
      completed_by_member_id: "old-keeper",
      voided_by_member_id: "old-owner",
      completed_by_name: "Historical display name",
    }, memberIds),
    {
      id: "event-1",
      completed_by_member_id: "new-keeper",
      voided_by_member_id: "new-owner",
      completed_by_name: "Historical display name",
    },
  );
  assert.equal(
    remapMemberReferences("rewardPayouts", { member_id: "old-keeper" }, memberIds).member_id,
    "new-keeper",
  );
});

test("household restore matches ids, then names, and maps the Head Keeper by role", () => {
  const existing = [
    { id: "current-owner", displayName: "Current Head Keeper", role: "Owner" as const },
    { id: "current-keeper", displayName: "Sample Keeper", role: "Zookeeper" as const },
  ];
  assert.equal(matchingExistingMember({
    id: "old-keeper",
    display_name: "sample keeper",
    role: "Zookeeper",
  }, existing)?.id, "current-keeper");
  assert.equal(matchingExistingMember({
    id: "old-owner",
    display_name: "Previous Head Keeper",
    role: "Owner",
  }, existing)?.id, "current-owner");
  assert.equal(matchingExistingMember({
    id: "current-owner",
    display_name: "Different Keeper",
    role: "Zookeeper",
  }, existing), null);
});
