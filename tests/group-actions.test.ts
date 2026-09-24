import assert from "node:assert/strict";
import test from "node:test";

import { groupToast, type MemberOutcome } from "../lib/group-actions.ts";

const ok = (animalName: string, note = `${animalName}: done`): MemberOutcome => ({ animalName, result: { ok: true, note } });
const bad = (animalName: string, error = "boom"): MemberOutcome => ({ animalName, result: { ok: false, error } });

test("a single success shows that task's own note", () => {
  const { message } = groupToast([ok("Ziggy", "Ziggy: fed · 1 rat used")], { title: "Feed", verb: "recorded" });
  assert.equal(message, "Ziggy: fed · 1 rat used");
});

test("a whole group succeeding reads as one line, not N toasts", () => {
  const { message } = groupToast([ok("A"), ok("B"), ok("C")], { title: "Mist", verb: "recorded", viewerName: "Kai" });
  assert.equal(message, "Mist: recorded for all 3 animals by Kai");
});

test("a middle member failing is reported, never hidden by the others' success", () => {
  // The bug this whole change exists for: 2 succeed, 1 fails, and the group must
  // NOT claim blanket success.
  const { message } = groupToast([ok("Alpha"), bad("Bravo", "Simulated server error"), ok("Charlie")], { title: "Wipe glass", verb: "recorded" });
  assert.match(message, /Saved 2 of 3/);
  assert.match(message, /Bravo/);
  assert.match(message, /Simulated server error/);
  assert.doesNotMatch(message, /for all 3 animals/);
});

test("every member failing does not pretend anything saved", () => {
  const { message } = groupToast([bad("Alpha"), bad("Bravo")], { title: "Skip", verb: "skipped" });
  assert.match(message, /^Couldn’t save Alpha, Bravo/);
  assert.doesNotMatch(message, /Saved/);
});

test("the verb carries through so skip and miss do not read as 'recorded'", () => {
  assert.match(groupToast([ok("A"), ok("B")], { title: "Mist", verb: "skipped" }).message, /skipped for all 2/);
  assert.match(groupToast([ok("A"), ok("B")], { title: "Mist", verb: "marked missed" }).message, /marked missed for all 2/);
});
