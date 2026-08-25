// A column that exists in the database but is missing from the backup manifest
// is invisible: backups keep working, restores keep working, and the data in
// that column is silently dropped on the way through. That is exactly what
// happened to the skip columns and to husbandry_events.outcome — both were
// added to the schema and neither reached a backup until this test was written.
//
// So rather than checking a fixed list, this reads the schema out of
// db/runtime.ts and asserts the manifest covers every column of every table it
// claims to back up.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PORTABLE_RESOURCES } from "../lib/portable-backup.ts";

const runtimeSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "db", "runtime.ts"),
  "utf8",
);

/** Column names from the CREATE TABLE statements, keyed by table. */
function columnsFromCreateStatements(source: string): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const createPattern = /CREATE TABLE IF NOT EXISTS (\w+) \(([^"]*)\)"/g;
  for (const match of source.matchAll(createPattern)) {
    const [, table, body] = match;
    // Split on top-level commas, then take the first word of each fragment.
    const columns = new Set<string>();
    let level = 0;
    let fragment = "";
    for (const character of body) {
      if (character === "(") level += 1;
      if (character === ")") level -= 1;
      if (character === "," && level === 0) {
        const name = /^\s*(\w+)/.exec(fragment);
        if (name) columns.add(name[1]);
        fragment = "";
        continue;
      }
      fragment += character;
    }
    const last = /^\s*(\w+)/.exec(fragment);
    if (last) columns.add(last[1]);
    // Table constraints are not columns.
    for (const keyword of ["PRIMARY", "UNIQUE", "FOREIGN", "CHECK", "CONSTRAINT"]) columns.delete(keyword);
    tables.set(table, columns);
  }
  return tables;
}

/** Columns added later via addMissingColumns(db, "table", [["col", …], …]). */
function columnsFromMigrations(source: string): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const pattern = /addMissingColumns\(\s*db,\s*"(\w+)",\s*\[([\s\S]*?)\]\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    const [, table, body] = match;
    const columns = tables.get(table) ?? new Set<string>();
    for (const column of body.matchAll(/\[\s*"(\w+)"/g)) columns.add(column[1]);
    tables.set(table, columns);
  }
  return tables;
}

const created = columnsFromCreateStatements(runtimeSource);
const migrated = columnsFromMigrations(runtimeSource);

test("the schema parses into something usable", () => {
  // Guard against the parser quietly matching nothing and the real assertions
  // below passing over an empty set.
  assert.ok(created.size > 10, `only found ${created.size} tables`);
  assert.ok(created.get("animals")?.has("name"), "animals.name not found");
  assert.ok(migrated.get("care_tasks")?.has("skipped_at"), "care_tasks.skipped_at not found");
});

test("every backed-up table exists in the schema", () => {
  for (const [resource, definition] of Object.entries(PORTABLE_RESOURCES)) {
    assert.ok(
      created.has(definition.table),
      `${resource} backs up ${definition.table}, which is not created in db/runtime.ts`,
    );
  }
});

test("the backup manifest covers every column of every table it backs up", () => {
  const missing: string[] = [];
  for (const [resource, definition] of Object.entries(PORTABLE_RESOURCES)) {
    const schemaColumns = new Set([
      ...(created.get(definition.table) ?? []),
      ...(migrated.get(definition.table) ?? []),
    ]);
    const backedUp = new Set<string>(definition.columns);
    for (const column of schemaColumns) {
      if (!backedUp.has(column)) missing.push(`${definition.table}.${column} (resource ${resource})`);
    }
  }
  assert.deepEqual(missing, [], `columns would be dropped by backup/restore:\n  ${missing.join("\n  ")}`);
});

test("the manifest does not claim columns the schema does not have", () => {
  const unknown: string[] = [];
  for (const [resource, definition] of Object.entries(PORTABLE_RESOURCES)) {
    const schemaColumns = new Set([
      ...(created.get(definition.table) ?? []),
      ...(migrated.get(definition.table) ?? []),
    ]);
    for (const column of definition.columns) {
      if (!schemaColumns.has(column)) unknown.push(`${definition.table}.${column} (resource ${resource})`);
    }
  }
  assert.deepEqual(unknown, [], `manifest lists columns that do not exist:\n  ${unknown.join("\n  ")}`);
});

// household_members is deliberately outside PORTABLE_RESOURCES: a restore
// rebuilds keepers with fresh, disabled credentials rather than carrying access
// code hashes between installs. But that means the export hand-writes one
// column list and the restore hand-writes another, with nothing holding either
// to the schema — the same two-independent-lists shape that lost shed_events.
// Every column has to be named as carried or as deliberately left behind.
const HOUSEHOLD_CARRIED = ["id", "display_name", "role", "earning_enabled", "created_at", "updated_at"];
const HOUSEHOLD_DELIBERATELY_DROPPED = [
  "access_code_hash", // never leaves an install; restore mints a disabled one
  "active",           // restored keepers arrive disabled until reissued a code
  "last_login_at",    // belongs to the install it happened on
];

test("every household_members column is classified as carried or dropped", () => {
  const columns = columnsFromCreateStatements(runtimeSource).get("household_members");
  assert.ok(columns, "household_members should be created by the runtime schema");
  const classified = new Set([...HOUSEHOLD_CARRIED, ...HOUSEHOLD_DELIBERATELY_DROPPED]);
  const unclassified = [...columns].filter((column) => !classified.has(column));
  assert.deepEqual(unclassified, [], `household_members columns nobody has decided about: ${unclassified.join(", ")}`);
});

test("the household_members export actually names the columns it carries", () => {
  const exportSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "app", "api", "export", "route.ts"),
    "utf8",
  );
  for (const column of HOUSEHOLD_CARRIED) {
    assert.ok(exportSource.includes(column), `export drops household_members.${column}`);
  }
  // A credential must never be written into a portable bundle.
  assert.ok(!/household_members[\s\S]{0,400}access_code_hash/.test(exportSource),
    "the export must not carry access code hashes");
});
