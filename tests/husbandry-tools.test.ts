import assert from "node:assert/strict";
import test from "node:test";
import { createHusbandryToolExecutor } from "../lib/husbandry-tools.ts";

test("a voice log without optional notes binds null instead of undefined", async () => {
  const boundValues: unknown[][] = [];
  const fakeDb = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          boundValues.push(values);
          assert.ok(
            values.every((value) => value !== undefined),
            `D1 bind received undefined for: ${sql}`,
          );
          return {
            async all() {
              return { results: [] };
            },
            async run() {
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
  const executeTool = createHusbandryToolExecutor({
    db: fakeDb as never,
    roster: [
      {
        id: "achilles",
        name: "Achilles",
        species: "Ball Python",
        groupName: "Reptile",
      },
    ],
    today: "2026-07-19",
    now: () => new Date("2026-07-19T21:00:00.000Z"),
  });

  const result = await executeTool("log_husbandry_task", {
    animal_name: "Achilles",
    task_type: "feeding",
  });

  assert.equal(result.ok, true);
  assert.equal(result.saved, true);
  const insertValues = boundValues.at(-1);
  assert.ok(insertValues);
  assert.equal(insertValues[5], null);
});
