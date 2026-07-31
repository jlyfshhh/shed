import { isIsoDate } from "./date.ts";

export type BulkFeederInput = {
  preySpecies?: unknown;
  sizeClass?: unknown;
  weightsGrams?: unknown;
  addedOn?: unknown;
  notes?: unknown;
};

export function normalizeBulkFeeders(input: BulkFeederInput, defaultDate: string) {
  const preySpecies = cleanLabel(input.preySpecies, "Prey species");
  const sizeClass = cleanLabel(input.sizeClass, "Size class");
  if (!Array.isArray(input.weightsGrams) || input.weightsGrams.length === 0) {
    throw new Error("Enter at least one feeder weight");
  }
  if (input.weightsGrams.length > 500) throw new Error("Add no more than 500 feeders at once");
  const weightsGrams = input.weightsGrams.map((value, index) => {
    const weight = Number(value);
    if (!Number.isInteger(weight) || weight < 1 || weight > 5000) {
      throw new Error(`Weight ${index + 1} must be a whole number from 1 to 5000 grams`);
    }
    return weight;
  });
  const addedOn = typeof input.addedOn === "string" && input.addedOn.trim()
    ? input.addedOn.trim()
    : defaultDate;
  if (!isIsoDate(addedOn)) throw new Error("Added date must use YYYY-MM-DD");
  const notes = typeof input.notes === "string" && input.notes.trim()
    ? input.notes.trim().slice(0, 500)
    : null;
  return { preySpecies, sizeClass, weightsGrams, addedOn, notes };
}

function cleanLabel(value: unknown, label: string) {
  const cleaned = typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 80) : "";
  if (!cleaned) throw new Error(`${label} is required`);
  return cleaned;
}
