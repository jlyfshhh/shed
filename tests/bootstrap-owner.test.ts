import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { createInitialOwner } from "../lib/bootstrap-owner.ts";

class BoundStatement {
  private readonly statement: StatementSync;
  private readonly values: SQLInputValue[];

  constructor(
    statement: StatementSync,
    values: SQLInputValue[] = [],
  ) {
    this.statement = statement;
    this.values = values;
  }

  bind(...values: unknown[]) {
    return new BoundStatement(this.statement, values as SQLInputValue[]);
  }

  run() {
    const result = this.statement.run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

test("the initial Owner slot is claimed atomically and cannot be claimed twice", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE household_members (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL,
      access_code_hash TEXT NOT NULL,
      active INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    );
  `);
  const db = {
    prepare(sql: string) {
      return new BoundStatement(sqlite.prepare(sql));
    },
  } as unknown as D1Database;

  const first = await createInitialOwner(db, {
    id: "owner-a",
    displayName: "Head Keeper",
    accessCodeHash: "hash-a",
    timestamp: "2026-08-11T12:00:00.000Z",
  });
  const second = await createInitialOwner(db, {
    id: "owner-b",
    displayName: "Second Owner",
    accessCodeHash: "hash-b",
    timestamp: "2026-08-11T12:00:00.001Z",
  });

  assert.equal(first, true);
  assert.equal(second, false);
  assert.deepEqual(
    sqlite.prepare("SELECT id, display_name, role FROM household_members").all().map((row) => ({ ...row })),
    [{ id: "owner-a", display_name: "Head Keeper", role: "Owner" }],
  );
});
