import assert from "node:assert/strict";
import test from "node:test";

import { careTaskId, groupTasks, parseAnimalIds, scheduleAnimalIds, serializeAnimalIds, taskGroupKey } from "../lib/care-group.ts";

test("a plan with no list covers exactly its one animal", () => {
  assert.deepEqual(scheduleAnimalIds({ animalId: "a1", animalIdsJson: null }), ["a1"]);
  assert.deepEqual(scheduleAnimalIds({ animalId: "a1" }), ["a1"]);
});

test("the primary animal leads and is never duplicated", () => {
  const ids = scheduleAnimalIds({ animalId: "a1", animalIdsJson: JSON.stringify(["a2", "a1", "a3"]) });
  assert.deepEqual(ids, ["a1", "a2", "a3"]);
});

test("a damaged list degrades to the one animal rather than throwing", () => {
  // Restores and hand edits are both real. Losing the group is recoverable;
  // a care list that will not render is not.
  for (const broken of ["", "not json", "{}", "[1,2,3]", "null", '["  "]']) {
    assert.deepEqual(scheduleAnimalIds({ animalId: "a1", animalIdsJson: broken }), ["a1"], broken);
  }
  assert.deepEqual(parseAnimalIds("[\"a2\", 7, null, \"a3\"]"), ["a2", "a3"]);
});

test("single-animal plans store no list at all", () => {
  // Existing rows must stay byte-identical, so nothing about them changes.
  assert.equal(serializeAnimalIds(["a1"], "a1"), null);
  assert.equal(serializeAnimalIds([], "a1"), null);
  assert.equal(serializeAnimalIds(["a1", "a1"], "a1"), null);
  assert.equal(serializeAnimalIds(["a1", "a2"], "a1"), JSON.stringify(["a1", "a2"]));
});

test("the primary animal keeps its original task id forever", () => {
  // Task ids are what make re-materialization idempotent. If adding a second
  // animal changed the primary's id, that animal would get a duplicate task for
  // every date it already had one.
  assert.equal(careTaskId("s1", "a1", "a1", "2026-08-21"), "s1:2026-08-21");
  assert.equal(careTaskId("s1", "a2", "a1", "2026-08-21"), "s1:a2:2026-08-21");
});

test("added animals get ids that cannot collide with the primary", () => {
  const ids = new Set(["a1", "a2", "a3"].map((animal) => careTaskId("s1", animal, "a1", "2026-08-21")));
  assert.equal(ids.size, 3);
});

test("tasks from one plan on one day are one group", () => {
  const a = { scheduleId: "s1", dueDate: "2026-08-21", animalId: "a1" };
  const b = { scheduleId: "s1", dueDate: "2026-08-21", animalId: "a2" };
  assert.equal(taskGroupKey(a), taskGroupKey(b));
});

test("the same plan on a different day is a different group", () => {
  assert.notEqual(
    taskGroupKey({ scheduleId: "s1", dueDate: "2026-08-21", animalId: "a1" }),
    taskGroupKey({ scheduleId: "s1", dueDate: "2026-08-22", animalId: "a1" }),
  );
});

test("a one-off task is always its own group", () => {
  // Two ad-hoc tasks on the same animal and day must not merge into one line.
  const first = { scheduleId: null, dueDate: "2026-08-21", animalId: "a1" };
  const second = { scheduleId: null, dueDate: "2026-08-21", animalId: "a2" };
  assert.notEqual(taskGroupKey(first), taskGroupKey(second));
});

test("grouping keeps the order tasks arrived in", () => {
  const tasks = [
    { scheduleId: "s1", dueDate: "2026-08-21", animalId: "a1" },
    { scheduleId: "s2", dueDate: "2026-08-21", animalId: "b1" },
    { scheduleId: "s1", dueDate: "2026-08-21", animalId: "a2" },
  ];
  const groups = groupTasks(tasks);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].tasks.map((t) => t.animalId), ["a1", "a2"]);
  assert.deepEqual(groups[1].tasks.map((t) => t.animalId), ["b1"]);
});
