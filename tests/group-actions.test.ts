import assert from "node:assert/strict";
import test from "node:test";

import { groupToast, type MemberOutcome, type FeederUse } from "../lib/group-actions.ts";

const ok = (animalName: string, note = `${animalName}: done`): MemberOutcome => ({ animalName, result: { ok: true, note } });
const bad = (animalName: string, error = "boom"): MemberOutcome => ({ animalName, result: { ok: false, error } });
const fed = (animalName: string, feeder: FeederUse): MemberOutcome =>
  ({ animalName, result: { ok: true, note: `${animalName}: fed`, feeder } });
const short = (animalName: string): MemberOutcome =>
  ({ animalName, result: { ok: true, note: `${animalName}: fed`, feeder: null, shortage: true, slow: true } });

const feed = { title: "Feed", verb: "recorded", feederAware: true } as const;

test("a single success shows that task's own note", () => {
  const { message } = groupToast([ok("Ziggy", "Ziggy: fed · 1 rat used")], { title: "Feed", verb: "recorded" });
  assert.equal(message, "Ziggy: fed · 1 rat used");
});

test("a whole group succeeding reads as one line, not N toasts", () => {
  const { message } = groupToast([ok("A"), ok("B"), ok("C")], { title: "Mist", verb: "recorded", viewerName: "Kai" });
  assert.equal(message, "Mist: recorded for all 3 animals by Kai");
});

test("a middle member failing is reported, never hidden by the others' success", () => {
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

// ── Feeder aggregation on grouped feedings (Codex blocker) ───────────────────

test("a grouped feeding names the feeders consumed, not just 'recorded for all'", () => {
  const { message } = groupToast([
    fed("Achilles", { sizeClass: "small", preySpecies: "rat" }),
    fed("Ares", { sizeClass: "small", preySpecies: "rat" }),
  ], feed);
  assert.match(message, /recorded for all 2 animals/);
  assert.match(message, /2× small rat used/);
});

test("mixed feeder sizes are counted separately", () => {
  const { message } = groupToast([
    fed("Achilles", { sizeClass: "small", preySpecies: "rat" }),
    fed("Ares", { sizeClass: "medium", preySpecies: "rat" }),
    fed("Calypso", { sizeClass: "small", preySpecies: "rat" }),
  ], feed);
  assert.match(message, /2× small rat/);
  assert.match(message, /1× medium rat/);
});

test("one shortage names the animal and warns, and does not read as blanket success", () => {
  const { message, ms } = groupToast([
    fed("Achilles", { sizeClass: "small", preySpecies: "rat" }),
    short("Ares"),
  ], feed);
  assert.match(message, /1× small rat used/);
  assert.match(message, /no feeder deducted for Ares/);
  assert.equal(ms, 5200, "a shortage should hold the toast longer");
});

test("several shortages list every affected animal", () => {
  const { message } = groupToast([short("Ares"), short("Calypso"), fed("Achilles", { sizeClass: "small", preySpecies: "rat" })], feed);
  assert.match(message, /no feeder deducted for Ares, Calypso/);
  assert.match(message, /1× small rat used/);
});

test("a partial failure on a feeding still reports the failure, not feeders", () => {
  const { message } = groupToast([fed("Achilles", { sizeClass: "small", preySpecies: "rat" }), bad("Ares", "server error")], feed);
  assert.match(message, /Saved 1 of 2/);
  assert.match(message, /Ares/);
  assert.doesNotMatch(message, /small rat/);
});

test("a single feeding keeps its own detailed note", () => {
  const { message } = groupToast([fed("Achilles", { sizeClass: "small", preySpecies: "rat" })], feed);
  assert.equal(message, "Achilles: fed");
});

test("a non-feeding group stays a concise summary with no feeder clause", () => {
  const { message } = groupToast([ok("A"), ok("B"), ok("C")], { title: "Mist", verb: "recorded" });
  assert.equal(message, "Mist: recorded for all 3 animals");
});
