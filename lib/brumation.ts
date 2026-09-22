// Brumation pause helpers. The suppression itself is SQL (`a.brumating = 0` on
// every care-task listing, and the materializer skip below), but the decision
// of whether to create a given task is pure and worth testing on its own.

export type BrumationPause = {
  /** Currently paused: create and show nothing. */
  brumating: boolean | number;
  /** Per-animal lookback floor set when brumation ended: do not backfill before it. */
  careResumeOn?: string | null;
};

/**
 * Whether a task for one animal on one date must not be materialized.
 *
 * While brumating, nothing at all. After a brumation ends, nothing dated before
 * the resume day either — otherwise the 14-day backfill would refill the whole
 * pause with overdue tasks the keeper deliberately skipped.
 */
export function skipCareTask(pause: BrumationPause | undefined, date: string): boolean {
  if (!pause) return false;
  if (pause.brumating) return true;
  return pause.careResumeOn != null && date < pause.careResumeOn;
}
