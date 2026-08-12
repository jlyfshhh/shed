/**
 * Claim the one initial Owner slot with one atomic SQLite statement.
 *
 * A separate COUNT followed by INSERT has a race: two phones can both observe
 * an empty household and create two Owners. INSERT ... SELECT ... WHERE NOT
 * EXISTS makes the decision and the write one statement, so SQLite serializes
 * concurrent attempts and exactly one caller reports a change.
 */
export async function createInitialOwner(
  db: D1Database,
  owner: {
    id: string;
    displayName: string;
    accessCodeHash: string;
    timestamp: string;
  },
): Promise<boolean> {
  const result = await db.prepare(
    `INSERT INTO household_members
       (id, display_name, role, access_code_hash, active, created_at, updated_at, last_login_at)
     SELECT ?, ?, 'Owner', ?, 1, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM household_members)`,
  ).bind(
    owner.id,
    owner.displayName,
    owner.accessCodeHash,
    owner.timestamp,
    owner.timestamp,
    owner.timestamp,
  ).run();
  return Number(result.meta?.changes ?? 0) === 1;
}
