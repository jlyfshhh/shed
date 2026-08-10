// Shed quality, shared by the API, the profile UI, and the manage console so
// the four values can never drift apart between them.
//
// The wording is deliberately what a keeper would say out loud rather than
// clinical terms: someone logging a shed at 11pm should not have to work out
// whether "dysecdysis" applies to what they are holding.
export const SHED_QUALITIES = ["complete", "patchy", "stuck-eyecaps", "retained-tail"] as const;

export type ShedQuality = (typeof SHED_QUALITIES)[number];

export const SHED_QUALITY_LABELS: Record<ShedQuality, string> = {
  complete: "Complete, one piece",
  patchy: "Patchy or in pieces",
  "stuck-eyecaps": "Stuck eyecaps",
  "retained-tail": "Retained tail tip",
};

export function isShedQuality(value: string): value is ShedQuality {
  return (SHED_QUALITIES as readonly string[]).includes(value);
}

/** Anything other than a clean single-piece shed is worth a second look. */
export function isPoorShed(quality: string): boolean {
  return isShedQuality(quality) && quality !== "complete";
}

/**
 * Whole days between the two most recent sheds, given the newest-first list the
 * profile API returns. Null when there is nothing to compare against.
 *
 * Dates are parsed as UTC midnight rather than local so a daylight-saving
 * boundary inside the interval cannot round the answer to the wrong day.
 */
export function shedIntervalDays(history: ReadonlyArray<{ recordedOn: string }>): number | null {
  if (history.length < 2) return null;
  const newest = Date.parse(`${history[0].recordedOn}T00:00:00Z`);
  const previous = Date.parse(`${history[1].recordedOn}T00:00:00Z`);
  if (!Number.isFinite(newest) || !Number.isFinite(previous)) return null;
  return Math.round((newest - previous) / 86_400_000);
}
