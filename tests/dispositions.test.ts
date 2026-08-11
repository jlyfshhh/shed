import assert from "node:assert/strict";
import test from "node:test";

/**
 * Skipped, missed, and refused are three different statements about one task,
 * and the whole value of recording them is that they stay distinguishable.
 *
 *   missed   — the care should have happened and did not. A lapse.
 *   skipped  — the keeper judged it did not need doing. Not a lapse.
 *   refused  — the care happened; the animal declined. Not a lapse either, and
 *              the feeder is gone regardless.
 *
 * These check the scoring arithmetic those definitions imply, using the same
 * shape as the query in app/api/animals/[id]/route.ts.
 */

type Task = { dueDate: string; completed: boolean; missed?: boolean; skipped?: boolean };

/** Mirrors the husbandry-score query: skipped tasks leave the denominator. */
function score(tasks: Task[], today: string) {
  const past = tasks.filter((task) => task.dueDate < today);
  // Completion wins defensively if an older/restored row carries both flags.
  const accountable = past.filter((task) => !task.skipped || task.completed).length
    + tasks.filter((task) => task.dueDate === today && task.completed).length;
  const done = past.filter((task) => task.completed).length
    + tasks.filter((task) => task.dueDate === today && task.completed).length;
  return {
    percent: accountable > 0 ? Math.round((done / accountable) * 100) : null,
    done,
    accountable,
    skipped: tasks.filter((task) => task.skipped && !task.completed).length,
  };
}

const TODAY = "2026-08-09";

test("a skipped task does not lower the score", () => {
  const done: Task[] = [
    { dueDate: "2026-08-07", completed: true },
    { dueDate: "2026-08-08", completed: true },
  ];
  const perfect = score(done, TODAY);
  assert.equal(perfect.percent, 100);

  // Adding an untouched task drags the score down, which is correct — it is a
  // lapse until it is dispositioned.
  const withOutstanding = score([...done, { dueDate: "2026-08-08", completed: false }], TODAY);
  assert.equal(withOutstanding.percent, 67);

  // Skipping that same task restores it: the keeper decided it was not needed.
  const withSkip = score([...done, { dueDate: "2026-08-08", completed: false, skipped: true }], TODAY);
  assert.equal(withSkip.percent, 100, "a skip must not count against the keeper");
  assert.equal(withSkip.accountable, 2, "a skipped task leaves the denominator");
  assert.equal(withSkip.skipped, 1, "and is still reported, so the number is explicable");
});

test("a missed task still counts against the score", () => {
  // The distinction that makes skipping worth having: this one is a lapse.
  const withMiss = score([
    { dueDate: "2026-08-07", completed: true },
    { dueDate: "2026-08-08", completed: false, missed: true },
  ], TODAY);
  assert.equal(withMiss.percent, 50);
  assert.equal(withMiss.accountable, 2);
  assert.equal(withMiss.skipped, 0);
});

test("skipping everything leaves no score rather than a zero", () => {
  // A week of deliberate rest is not 0% husbandry, and showing 0% would be a
  // lie about the keeper's care.
  const resting = score([
    { dueDate: "2026-08-07", completed: false, skipped: true },
    { dueDate: "2026-08-08", completed: false, skipped: true },
  ], TODAY);
  assert.equal(resting.percent, null);
  assert.equal(resting.accountable, 0);
  assert.equal(resting.skipped, 2);
});

test("a refused meal counts as done, because the care happened", () => {
  // The keeper thawed it, offered it, and lost the feeder. The animal declining
  // is a health signal, not a housekeeping failure, so it must not read as one.
  const refusedIsCompleted: Task = { dueDate: "2026-08-08", completed: true };
  const withRefusal = score([
    { dueDate: "2026-08-07", completed: true },
    refusedIsCompleted,
  ], TODAY);
  assert.equal(withRefusal.percent, 100);
});

test("a legacy completed-and-skipped row cannot push the score over 100", () => {
  const legacyRace = score([
    { dueDate: "2026-08-08", completed: true, skipped: true },
  ], TODAY);
  assert.equal(legacyRace.percent, 100);
  assert.equal(legacyRace.done, 1);
  assert.equal(legacyRace.accountable, 1);
  assert.equal(legacyRace.skipped, 0);
});

test("today's outstanding work is not yet a failure", () => {
  // Pre-existing behaviour worth pinning: the day is not over.
  const midday = score([
    { dueDate: TODAY, completed: false },
    { dueDate: TODAY, completed: true },
  ], TODAY);
  assert.equal(midday.percent, 100);
  assert.equal(midday.accountable, 1);
});

test("a skipped task leaves the day's list and the day's totals", () => {
  // Mirrors the partitioning in HusbandryApp: a skipped task is neither
  // pending nor counted, but a skip that was later completed is both.
  const tasks = [
    { id: "a", complete: false, skippedAt: null },
    { id: "b", complete: true, skippedAt: null },
    { id: "c", complete: false, skippedAt: "2026-08-10T10:00:00Z" },
    { id: "d", complete: true, skippedAt: "2026-08-10T09:00:00Z" },
  ];
  const skipped = tasks.filter((t) => t.skippedAt && !t.complete);
  const accountable = tasks.filter((t) => !t.skippedAt || t.complete);
  const pending = accountable.filter((t) => !t.complete);
  const completed = accountable.filter((t) => t.complete);

  assert.deepEqual(skipped.map((t) => t.id), ["c"]);
  assert.deepEqual(pending.map((t) => t.id), ["a"], "a skipped task must not stay on the list");
  assert.deepEqual(completed.map((t) => t.id), ["b", "d"]);
  // Three accountable, two done: the skip is out of the denominator, so the
  // day can still reach 100% rather than being stuck below it forever.
  assert.equal(accountable.length, 3);
  assert.equal(Math.round((completed.length / accountable.length) * 100), 67);

  const allSkipped = [{ id: "x", complete: false, skippedAt: "2026-08-10T10:00:00Z" }];
  const noneAccountable = allSkipped.filter((t) => !t.skippedAt || t.complete);
  assert.equal(noneAccountable.length, 0, "a fully skipped day must not divide by zero");
  const allSkippedPercent = noneAccountable.length
    ? Math.round((noneAccountable.filter((task) => task.complete).length / noneAccountable.length) * 100)
    : allSkipped.length ? 100 : 0;
  assert.equal(allSkippedPercent, 100, "a fully skipped day is settled, not zero percent");
});
