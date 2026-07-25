import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKUP_SCHEMA_VERSION,
  matchingExistingMember,
  PORTABLE_APP_SETTING_KEYS,
  PORTABLE_RESOURCES,
  remapMemberReferences,
} from "../lib/portable-backup.ts";

test("schema 9 carries allowance, missed-task, payout, and care-baseline data", () => {
  assert.equal(BACKUP_SCHEMA_VERSION, 9);
  assert.ok(PORTABLE_RESOURCES.careSchedules.columns.includes("reward_cents"));
  assert.ok(PORTABLE_RESOURCES.careTasks.columns.includes("missed_at"));
  assert.ok(PORTABLE_RESOURCES.husbandryEvents.columns.includes("reward_cents"));
  assert.deepEqual(PORTABLE_RESOURCES.rewardPayouts.columns, [
    "id", "member_id", "amount_cents", "note", "paid_at", "paid_by_member_id", "paid_by_name",
  ]);
  assert.deepEqual(PORTABLE_APP_SETTING_KEYS, ["default_reward_cents", "care_start_date"]);
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
