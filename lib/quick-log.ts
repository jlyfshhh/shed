// Pure helpers behind the enclosure-QR quick-log, kept out of the React
// component so the three decisions that actually matter — which occurrences are
// genuinely due, whether a row needs its date shown to be unambiguous, and what
// Save really recorded — can be tested without a DOM. Relative imports (not the
// "@/" alias) so the `node --test` suite resolves them like the other lib
// modules.
import { taskIsOverdue } from "./care-window.ts";

/** The dashboard-task fields the quick-log reasons about. */
export type QuickLogSource = {
  id: string;
  animalId: string;
  title: string;
  dueDate: string;
  graceDays?: number;
  complete: boolean;
  skippedAt: string | null;
  missedAt: string | null;
};

export type QuickLogTask = {
  id: string;
  title: string;
  dueDate: string;
  /** Past its grace window — completing it must ask when the care happened. */
  overdue: boolean;
  /** Show the due date beside the title because the title alone isn't unique. */
  showDueDate: boolean;
};

/**
 * The care rows for one animal's quick-log.
 *
 * Only genuinely-due care belongs here. A skipped or missed occurrence is
 * already settled — a keeper decided it did not need doing, or recorded that it
 * did not happen — so surfacing it as an unchecked "Feed" row invites re-logging
 * a day that was closed on purpose. The previous code collected every
 * `!complete` task and did exactly that, and because it kept only the title, two
 * occurrences on different days showed as identical rows. So settled skips and
 * misses are excluded, and the due date is attached whenever the title alone
 * can't tell two rows apart (two "Feed" occurrences) or the row isn't simply due
 * today — an overdue occurrence never hides behind an identical-looking current
 * one.
 */
export function collectQuickLogTasks(
  sources: readonly QuickLogSource[],
  animalId: string,
  today: string,
): QuickLogTask[] {
  const seen = new Set<string>();
  const due: QuickLogSource[] = [];
  for (const task of sources) {
    if (task.animalId !== animalId) continue;
    if (task.complete || task.skippedAt || task.missedAt) continue;
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    due.push(task);
  }

  const titleCounts = new Map<string, number>();
  for (const task of due) titleCounts.set(task.title, (titleCounts.get(task.title) ?? 0) + 1);

  return due.map((task) => ({
    id: task.id,
    title: task.title,
    dueDate: task.dueDate,
    overdue: taskIsOverdue(task.dueDate, task.graceDays ?? 0, today),
    showDueDate: task.dueDate !== today || (titleCounts.get(task.title) ?? 0) > 1,
  }));
}

/**
 * The keeper's chosen care date for an overdue row, bounded the same way the
 * Today view's timing dialog bounds it: never before the day it was due, never
 * after today. A current (not overdue) row has no choice to make — it is logged
 * as of today like any on-time completion — so it returns true.
 */
export function quickLogCareDateValid(task: QuickLogTask, chosen: string, today: string): boolean {
  if (!task.overdue) return true;
  return chosen >= task.dueDate && chosen <= today;
}

/** What one quick-log entry's save came back as. Feeder detail rides along in
 * `note`, composed by the same completion path the Today view uses, so a
 * shortage reads as recorded-but-flagged rather than as a failure. */
export type QuickLogEntryResult =
  | { ok: true; note: string; shortage?: boolean; slow?: boolean }
  | { ok: false; label: string; error: string };

export type QuickLogSaveSummary = {
  allSaved: boolean;
  savedCount: number;
  failedCount: number;
  message: string;
  /** A shortage (or any slow result) earns the longer toast, as on Today. */
  slow: boolean;
};

/**
 * Fold the per-entry results of one Save into the message the keeper sees.
 *
 * A feeder shortage is a successful save that carries a warning, not a failure,
 * so recorded care is never reported as lost; its "no feeder deducted — add it
 * in Manage → Feeders" wording already lives in each entry's note. Only a real
 * `ok: false` counts against the save, and when some entries landed and others
 * did not, the message says both so a retry targets only what's left.
 */
export function summariseQuickLogSave(results: readonly QuickLogEntryResult[]): QuickLogSaveSummary {
  const saved = results.filter((result): result is Extract<QuickLogEntryResult, { ok: true }> => result.ok);
  const failed = results.filter((result): result is Extract<QuickLogEntryResult, { ok: false }> => !result.ok);
  const slow = saved.some((result) => Boolean(result.slow) || Boolean(result.shortage));

  if (failed.length === 0) {
    const message = saved.map((result) => result.note).join(" · ") || "Nothing to save.";
    return { allSaved: true, savedCount: saved.length, failedCount: 0, message, slow };
  }

  const names = failed.map((result) => result.label).join(", ");
  const prefix = saved.length ? `Saved ${saved.length}. ` : "";
  return {
    allSaved: false,
    savedCount: saved.length,
    failedCount: failed.length,
    message: `${prefix}Couldn’t save: ${names}. Try again.`,
    slow,
  };
}
