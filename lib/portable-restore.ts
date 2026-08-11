import { checkAttachment } from "./attachments.ts";
import {
  matchingExistingMember,
  type ExistingMember,
  type PortableMember,
} from "./portable-backup.ts";

export type PreparedLightingSheet = {
  planId: string;
  name: string;
  mime: string;
  bytes: Uint8Array;
};

export type StagedLightingSheet = PreparedLightingSheet & { key: string };

export type RestoreObjectStore = {
  put(
    key: string,
    bytes: Uint8Array,
    options: { httpMetadata: { contentType: string }; customMetadata: { originalName: string } },
  ): Promise<unknown>;
  delete(keys: string | string[]): Promise<unknown>;
};

export type HouseholdProfileOperation =
  | {
    kind: "insert";
    id: string;
    displayName: string;
    accessCodeHash: string;
    earningEnabled: number;
    createdAt: string;
    updatedAt: string;
  }
  | { kind: "updateEarning"; id: string; earningEnabled: number; updatedAt: string };

export type HouseholdProfilePlan = {
  memberIds: Map<string, string>;
  operations: HouseholdProfileOperation[];
  restored: number;
};

const isPortableMember = (value: unknown): value is PortableMember => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const member = value as Record<string, unknown>;
  return typeof member.id === "string"
    && typeof member.display_name === "string"
    && member.display_name.trim().length > 0
    && member.display_name.trim().length <= 40
    && (member.role === "Owner" || member.role === "Zookeeper");
};

/**
 * Decide how portable household identities map into this Shed instance without
 * mutating the database. The caller converts the returned operations to D1
 * statements and includes them in the same batch as every other restore write.
 */
export function planHouseholdProfiles(
  rawMembers: unknown,
  existingMembers: readonly ExistingMember[],
  options: { now?: () => string; randomId?: () => string } = {},
): HouseholdProfilePlan {
  const now = options.now ?? (() => new Date().toISOString());
  const randomId = options.randomId ?? (() => crypto.randomUUID());
  const sourceMembers = (Array.isArray(rawMembers) ? rawMembers : []).filter(isPortableMember);
  const existing = [...existingMembers];
  const memberIds = new Map<string, string>();
  const operations: HouseholdProfileOperation[] = [];
  let restored = 0;

  for (const source of sourceMembers) {
    let target = matchingExistingMember(source, existing);
    if (!target && source.role === "Zookeeper") {
      const timestamp = now();
      const restoredId = existing.some((member) => member.id === source.id) ? randomId() : source.id;
      target = {
        id: restoredId,
        displayName: source.display_name.trim().replace(/\s+/g, " "),
        role: "Zookeeper",
      };
      operations.push({
        kind: "insert",
        id: target.id,
        displayName: target.displayName,
        accessCodeHash: `restored-disabled:${randomId()}`,
        earningEnabled: Number(source.earning_enabled ?? 0) ? 1 : 0,
        createdAt: typeof source.created_at === "string" ? source.created_at : timestamp,
        updatedAt: typeof source.updated_at === "string" ? source.updated_at : timestamp,
      });
      existing.push(target);
    }
    if (!target) continue;
    if (Object.hasOwn(source, "earning_enabled")) {
      operations.push({
        kind: "updateEarning",
        id: target.id,
        earningEnabled: Number(source.earning_enabled ?? 0) ? 1 : 0,
        updatedAt: now(),
      });
    }
    memberIds.set(source.id, target.id);
    restored += 1;
  }

  return { memberIds, operations, restored };
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/**
 * Decode an already-validated backup and repeat the byte signature check at
 * the storage boundary. The MIME returned by checkAttachment is authoritative;
 * the bundle's declared type is never persisted on trust.
 */
export function prepareLightingPlanSheets(rawSheets: unknown): PreparedLightingSheet[] {
  const records = Array.isArray(rawSheets) ? rawSheets : [];
  const seen = new Set<string>();
  return records.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`Invalid lighting plan attachment at index ${index}`);
    }
    const sheet = raw as Record<string, unknown>;
    const planId = typeof sheet.planId === "string" ? sheet.planId : "";
    const encoded = typeof sheet.dataBase64 === "string" ? sheet.dataBase64 : "";
    if (!planId || !encoded) throw new Error(`Invalid lighting plan attachment at index ${index}`);
    if (seen.has(planId)) throw new Error(`Lighting plan ${planId} has more than one attachment`);
    seen.add(planId);
    const bytes = decodeBase64(encoded);
    const verdict = checkAttachment(bytes, "document", typeof sheet.type === "string" ? sheet.type : null);
    if (!verdict.ok) throw new Error(`Invalid lighting plan attachment at index ${index}`);
    return {
      planId,
      name: typeof sheet.name === "string" && sheet.name.trim() ? sheet.name.trim().slice(0, 200) : "lighting-plan",
      mime: verdict.mime,
      bytes,
    };
  });
}

async function deleteInChunks(store: RestoreObjectStore, keys: readonly string[]) {
  for (let offset = 0; offset < keys.length; offset += 1_000) {
    await store.delete(keys.slice(offset, offset + 1_000));
  }
}

/**
 * R2 and D1 cannot share a transaction. Upload new objects under unique keys
 * first, then let D1 atomically point at them. A failed upload or D1 batch only
 * removes newly staged objects; existing files are never touched. Cleanup of
 * superseded objects is deliberately post-commit and non-fatal.
 */
export async function restoreWithStagedLightingSheets<T>(options: {
  sheets: readonly PreparedLightingSheet[];
  store: RestoreObjectStore;
  commit: (stagedByPlanId: ReadonlyMap<string, StagedLightingSheet>) => Promise<T>;
  cleanupSuperseded: () => Promise<void>;
  makeKey?: (sheet: PreparedLightingSheet) => string;
  onCleanupError?: (error: unknown, phase: "rollback" | "post-commit") => void;
}): Promise<T> {
  const staged: StagedLightingSheet[] = [];
  // Do not place the imported plan id in the object key. IDs originate in the
  // backup, while this namespace is ours to control.
  const makeKey = options.makeKey ?? (() => `lighting-plans/restored/${crypto.randomUUID()}`);

  try {
    for (const sheet of options.sheets) {
      const stagedSheet = { ...sheet, key: makeKey(sheet) };
      await options.store.put(stagedSheet.key, stagedSheet.bytes, {
        httpMetadata: { contentType: stagedSheet.mime },
        customMetadata: { originalName: stagedSheet.name },
      });
      staged.push(stagedSheet);
    }
  } catch (error) {
    try {
      await deleteInChunks(options.store, staged.map((sheet) => sheet.key));
    } catch (cleanupError) {
      options.onCleanupError?.(cleanupError, "rollback");
    }
    throw error;
  }

  let result: T;
  try {
    result = await options.commit(new Map(staged.map((sheet) => [sheet.planId, sheet])));
  } catch (error) {
    try {
      await deleteInChunks(options.store, staged.map((sheet) => sheet.key));
    } catch (cleanupError) {
      options.onCleanupError?.(cleanupError, "rollback");
    }
    throw error;
  }

  try {
    await options.cleanupSuperseded();
  } catch (cleanupError) {
    options.onCleanupError?.(cleanupError, "post-commit");
  }
  return result;
}

export type LightingSheetReference = { id: string; key: string };

/** Keys that belonged to affected rows before commit and have no live DB reference after commit. */
export function supersededLightingSheetKeys(
  previous: readonly LightingSheetReference[],
  currentKeys: ReadonlySet<string>,
  mode: "merge" | "replace",
  incomingPlanIds: ReadonlySet<string>,
): string[] {
  return [...new Set(previous
    .filter((reference) => mode === "replace" || incomingPlanIds.has(reference.id))
    .map((reference) => reference.key)
    .filter((key) => key && !currentKeys.has(key)))];
}

export async function deleteRestoreObjects(store: RestoreObjectStore, keys: readonly string[]) {
  await deleteInChunks(store, keys);
}
