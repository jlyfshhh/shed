import { ensureDatabase } from "@/db/runtime";
import { env } from "cloudflare:workers";
import { requireCapability } from "@/lib/household-auth";
import { internalErrorResponse } from "@/lib/api-errors";
import { MAX_BUNDLE_BYTES, validateBundle } from "@/lib/restore-plan";
import {
  PORTABLE_APP_SETTING_KEYS,
  PORTABLE_REPLACE_DELETE_ORDER,
  PORTABLE_RESOURCES,
  remapMemberReferences,
  type ExistingMember,
} from "@/lib/portable-backup";
import {
  deleteRestoreObjects,
  planHouseholdProfiles,
  prepareLightingPlanSheets,
  restoreWithStagedLightingSheets,
  supersededLightingSheetKeys,
  type HouseholdProfileOperation,
  type LightingSheetReference,
  type StagedLightingSheet,
} from "@/lib/portable-restore";

type RestorePayload = {
  mode?: "merge" | "replace";
  confirmation?: string;
  dryRun?: boolean;
  bundle?: Record<string, unknown>;
};

const noStore = { "Cache-Control": "no-store" };

function householdProfileStatement(db: D1Database, operation: HouseholdProfileOperation): D1PreparedStatement {
  if (operation.kind === "insert") {
    return db.prepare(
      "INSERT INTO household_members (id, display_name, role, access_code_hash, active, earning_enabled, created_at, updated_at) VALUES (?, ?, 'Zookeeper', ?, 0, ?, ?, ?)",
    ).bind(
      operation.id,
      operation.displayName,
      operation.accessCodeHash,
      operation.earningEnabled,
      operation.createdAt,
      operation.updatedAt,
    );
  }
  return db.prepare("UPDATE household_members SET earning_enabled = ?, updated_at = ? WHERE id = ?")
    .bind(operation.earningEnabled, operation.updatedAt, operation.id);
}

export async function POST(request: Request) {
  try {
    const db = await ensureDatabase();
    const auth = await requireCapability(request, db, "records.manage");
    if (auth.response) return auth.response;

    // Refuse an oversized bundle before it is buffered when the client sends a
    // length. The platform request limit remains the backstop for chunked bodies.
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_BUNDLE_BYTES) {
      return Response.json(
        { error: `A backup larger than ${Math.floor(MAX_BUNDLE_BYTES / (1024 * 1024))} MB cannot be restored here.` },
        { status: 413, headers: noStore },
      );
    }

    let payload: RestorePayload;
    try {
      payload = await request.json() as RestorePayload;
    } catch {
      return Response.json({ error: "This backup is not valid JSON." }, { status: 400, headers: noStore });
    }
    const bundle = payload.bundle;
    if (!bundle || Number(bundle.schemaVersion) < 8) {
      return Response.json({ error: "A Shed schema version 8+ JSON export is required" }, { status: 400, headers: noStore });
    }
    if (payload.mode === "replace" && !payload.dryRun && payload.confirmation !== "REPLACE") {
      return Response.json({ error: "Type REPLACE to confirm a full data restore" }, { status: 400, headers: noStore });
    }

    // Validate and decode everything before staging an object or preparing a
    // write. A bad late row or attachment cannot partially restore a backup.
    const validation = validateBundle(bundle);
    if (validation.errors.length) {
      return Response.json(
        { error: "This backup cannot be restored.", problems: validation.errors.slice(0, 20), checked: validation.counts },
        { status: 422, headers: noStore },
      );
    }
    if (payload.dryRun) {
      return Response.json(
        { dryRun: true, wouldRestore: validation.counts, mode: payload.mode ?? "merge" },
        { headers: noStore },
      );
    }

    const mode = payload.mode ?? "merge";
    const preparedSheets = prepareLightingPlanSheets(bundle.lightingPlanSheets);
    const incomingPlanIds = new Set(
      (Array.isArray(bundle.lightingPlans) ? bundle.lightingPlans : [])
        .map((plan) => plan && typeof plan === "object" ? String((plan as Record<string, unknown>).id ?? "") : "")
        .filter(Boolean),
    );
    const [existingMembersResult, previousSheetResult] = await Promise.all([
      db.prepare("SELECT id, display_name AS displayName, role FROM household_members ORDER BY created_at").all<ExistingMember>(),
      db.prepare("SELECT id, plan_sheet_key AS key FROM lighting_plans WHERE plan_sheet_key IS NOT NULL").all<LightingSheetReference>(),
    ]);
    const household = planHouseholdProfiles(bundle.householdMembers, existingMembersResult.results);
    const previousSheets = previousSheetResult.results;

    const result = await restoreWithStagedLightingSheets({
      sheets: preparedSheets,
      store: env.FILES,
      commit: async (stagedByPlanId) => {
        const writes: D1PreparedStatement[] = [];
        let imported = household.restored;

        // Replace-mode deletes, household changes, portable rows, and the
        // required default setting all share this one D1 transaction.
        if (mode === "replace") {
          writes.push(
            db.prepare("UPDATE household_members SET earning_enabled = 0"),
            db.prepare(`DELETE FROM app_settings WHERE key IN (${PORTABLE_APP_SETTING_KEYS.map(() => "?").join(", ")})`)
              .bind(...PORTABLE_APP_SETTING_KEYS),
            ...PORTABLE_REPLACE_DELETE_ORDER.map((table) => db.prepare(`DELETE FROM ${table}`)),
          );
        }
        writes.push(...household.operations.map((operation) => householdProfileStatement(db, operation)));

        for (const [bundleKey, definition] of Object.entries(PORTABLE_RESOURCES) as Array<[
          keyof typeof PORTABLE_RESOURCES,
          (typeof PORTABLE_RESOURCES)[keyof typeof PORTABLE_RESOURCES],
        ]>) {
          const rows = (Array.isArray(bundle[bundleKey]) ? bundle[bundleKey] as Array<Record<string, unknown>> : [])
            .filter((row) => bundleKey !== "appSettings" || PORTABLE_APP_SETTING_KEYS.includes(String(row.key) as (typeof PORTABLE_APP_SETTING_KEYS)[number]));
          for (const sourceRow of rows) {
            const row = remapMemberReferences(bundleKey, sourceRow, household.memberIds);
            if (bundleKey === "lightingPlans") applyStagedSheet(row, stagedByPlanId);
            const present = definition.columns.filter((column) => Object.hasOwn(row, column));
            if (!present.includes(definition.key)) throw new Error(`Invalid ${bundleKey} row`);
            writes.push(
              db.prepare(`INSERT OR REPLACE INTO ${definition.table} (${present.join(", ")}) VALUES (${present.map(() => "?").join(", ")})`)
                .bind(...present.map((column) => row[column] ?? null)),
            );
            imported += 1;
          }
        }
        writes.push(db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('default_reward_cents', '25')"));
        await db.batch(writes);
        return { imported: imported + preparedSheets.length };
      },
      cleanupSuperseded: async () => {
        const currentResult = await db.prepare(
          "SELECT plan_sheet_key AS key FROM lighting_plans WHERE plan_sheet_key IS NOT NULL",
        ).all<{ key: string }>();
        const currentKeys = new Set(currentResult.results.map((reference) => reference.key));
        const obsolete = supersededLightingSheetKeys(previousSheets, currentKeys, mode, incomingPlanIds);
        if (obsolete.length) await deleteRestoreObjects(env.FILES, obsolete);
      },
      onCleanupError: (error, phase) => {
        // Cleanup failure can leave an unreachable object, but must never turn
        // a committed restore into an apparent failure that encourages a retry.
        console.error(`Portable restore ${phase} object cleanup failed`, error);
      },
    });

    return Response.json(
      { saved: true, imported: result.imported, householdProfiles: household.restored, mode },
      { headers: noStore },
    );
  } catch (error) {
    // Database, R2, and schema internals should never be spoken back to a
    // browser. Validation errors are returned explicitly above.
    return internalErrorResponse(error, {
      context: "Portable restore failed",
      message: "Unable to restore this backup. Your existing records were not replaced.",
      headers: noStore,
    });
  }
}

function applyStagedSheet(
  row: Record<string, unknown>,
  stagedByPlanId: ReadonlyMap<string, StagedLightingSheet>,
) {
  const staged = stagedByPlanId.get(String(row.id ?? ""));
  row.plan_sheet_key = staged?.key ?? null;
  row.plan_sheet_name = staged?.name ?? null;
  row.plan_sheet_type = staged?.mime ?? null;
}
