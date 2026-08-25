import { checkAttachment } from "./attachments.ts";
import { PORTABLE_RESOURCES } from "./portable-backup.ts";

// A restore is the one operation that can destroy every record at once, so the
// entire bundle is checked before a single row is touched. Everything below is
// pure: it reads the bundle and reports, and changes nothing.
export const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;
export const MAX_ROWS_PER_RESOURCE = 100_000;
export const MAX_ATTACHMENTS = 2_000;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
/**
 * Ceiling on any single stored value. D1 refuses a value over roughly 2.1 MB
 * with SQLITE_TOOBIG, which surfaced as a bare 500 partway through a restore
 * rather than a refusal naming the row. Checking here means an oversized field
 * is reported like every other bad row, before anything is written.
 */
export const MAX_FIELD_CHARS = 2_000_000;

export type BundlePlan = { errors: string[]; counts: Record<string, number> };

function decodeBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

export function validateBundle(bundle: Record<string, unknown>): BundlePlan {
  const errors: string[] = [];
  const counts: Record<string, number> = {};
  const add = (message: string) => {
    if (errors.length < 100) errors.push(message);
  };

  for (const [bundleKey, definition] of Object.entries(PORTABLE_RESOURCES)) {
    const raw = bundle[bundleKey];
    if (raw !== undefined && !Array.isArray(raw)) {
      add(`${bundleKey} should be a list`);
      continue;
    }
    const rows = (Array.isArray(raw) ? raw : []) as Array<unknown>;
    if (rows.length > MAX_ROWS_PER_RESOURCE) {
      add(`${bundleKey} has ${rows.length} rows, more than the ${MAX_ROWS_PER_RESOURCE} allowed`);
      continue;
    }
    counts[bundleKey] = rows.length;

    const seen = new Set<string>();
    rows.forEach((row, index) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        add(`${bundleKey}[${index}] is not an object`);
        return;
      }
      for (const [column, value] of Object.entries(row as Record<string, unknown>)) {
        if (typeof value === "string" && value.length > MAX_FIELD_CHARS) {
          add(`${bundleKey}[${index}].${column} is ${value.length} characters, more than the ${MAX_FIELD_CHARS} a single value can hold`);
        }
      }
      const record = row as Record<string, unknown>;
      const key = record[definition.key];
      // Every insert binds this column; a row without it used to throw part
      // way through the restore, after earlier rows had already been written.
      if (key === undefined || key === null || key === "") {
        add(`${bundleKey}[${index}] has no ${definition.key}`);
        return;
      }
      const identifier = String(key);
      if (seen.has(identifier)) add(`${bundleKey} contains ${definition.key} ${identifier} more than once`);
      seen.add(identifier);
      if (
        bundleKey === "husbandryEvents"
        && Object.hasOwn(record, "outcome")
        && record.outcome !== "done"
        && record.outcome !== "refused"
      ) {
        add(`${bundleKey}[${index}] has an invalid outcome`);
      }
    });
  }

  // Attachments are decoded and inspected here rather than mid-restore, where
  // a failure would land after the database had already been emptied.
  const sheets = Array.isArray(bundle.lightingPlanSheets) ? bundle.lightingPlanSheets : [];
  counts.lightingPlanSheets = sheets.length;
  if (sheets.length > MAX_ATTACHMENTS) {
    add(`the backup carries ${sheets.length} attachments, more than the ${MAX_ATTACHMENTS} allowed`);
  } else {
    const sheetPlanIds = new Set<string>();
    const planIds = new Set(
      (Array.isArray(bundle.lightingPlans) ? bundle.lightingPlans : [])
        .map((plan) => (plan && typeof plan === "object" ? String((plan as Record<string, unknown>).id ?? "") : ""))
        .filter(Boolean),
    );
    sheets.forEach((sheet, index) => {
      if (!sheet || typeof sheet !== "object") {
        add(`attachment ${index} is not an object`);
        return;
      }
      const record = sheet as Record<string, unknown>;
      const planId = typeof record.planId === "string" ? record.planId : "";
      const encoded = typeof record.dataBase64 === "string" ? record.dataBase64 : "";
      if (!planId || !encoded) {
        add(`attachment ${index} is missing its plan id or contents`);
        return;
      }
      if (!planIds.has(planId)) {
        add(`attachment ${index} refers to lighting plan ${planId}, which is not in this backup`);
        return;
      }
      if (sheetPlanIds.has(planId)) {
        add(`lighting plan ${planId} has more than one attachment`);
        return;
      }
      sheetPlanIds.add(planId);
      const bytes = decodeBase64(encoded);
      if (!bytes) {
        add(`attachment ${index} is not valid base64`);
        return;
      }
      // checkAttachment enforces a limit too, so this is redundant and no test
      // can distinguish them. It stays because it short-circuits before the
      // validator inspects a large buffer, and because the two limits are free
      // to diverge later.
      if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
        add(`attachment ${index} is larger than ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB`);
        return;
      }
      // The same validator the upload routes use: the declared type is a claim,
      // and a bundle used to be able to store text/html and have Shed serve it.
      const verdict = checkAttachment(bytes, "document", typeof record.type === "string" ? record.type : null);
      if (!verdict.ok) add(`attachment ${index} (${planId}): ${verdict.error}`);
    });
  }

  const members = Array.isArray(bundle.householdMembers) ? bundle.householdMembers : [];
  counts.householdMembers = members.length;

  return { errors, counts };
}
