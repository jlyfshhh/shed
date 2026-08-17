import { isIsoDate } from "./date.ts";
import { ApiInputError } from "./api-errors.ts";

export type BulkFeederInput = {
  preySpecies?: unknown;
  sizeClass?: unknown;
  count?: unknown;
  addedOn?: unknown;
  notes?: unknown;
};

export function normalizeBulkFeeders(input: BulkFeederInput, defaultDate: string) {
  const preySpecies = cleanLabel(input.preySpecies, "Prey species");
  const sizeClass = cleanLabel(input.sizeClass, "Size class");
  // Feeders are counted, not weighed. A bag from a supplier is "20 small rats",
  // and the size class is what decides whether one suits an animal — weighing
  // each rat only ever produced precision the allocator immediately rounded away.
  const count = Number(input.count);
  if (!Number.isInteger(count) || count < 1 || count > 500) {
    throw new ApiInputError("Count must be a whole number from 1 to 500");
  }
  const addedOn = typeof input.addedOn === "string" && input.addedOn.trim()
    ? input.addedOn.trim()
    : defaultDate;
  if (!isIsoDate(addedOn)) throw new ApiInputError("Added date must use YYYY-MM-DD");
  const notes = typeof input.notes === "string" && input.notes.trim()
    ? input.notes.trim().slice(0, 500)
    : null;
  return { preySpecies, sizeClass, count, addedOn, notes };
}

function cleanLabel(value: unknown, label: string) {
  const cleaned = typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 80) : "";
  if (!cleaned) throw new ApiInputError(`${label} is required`);
  return cleaned;
}
