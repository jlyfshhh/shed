// Relative, not the "@/" alias: this module is covered by a `node --test` suite
// that resolves imports without the bundler's path mapping.
import { dateInTimeZone, DEFAULT_TIME_ZONE, isIsoDate } from "./date.ts";

/**
 * When an overdue task is finally logged, two different things may have
 * happened, and the record has no way to tell them apart on its own:
 *
 * - the care happened today, late; or
 * - the care happened on the day it was due and only the logging is late.
 *
 * `occurred_at` answers "when was the animal actually cared for", so the keeper
 * has to be the one to say. This resolves that answer into a timestamp.
 */

export class CompletionTimingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompletionTimingError";
  }
}

export type ResolveOccurredAtOptions = {
  /** The day the task was scheduled for. */
  dueDate: string;
  /** The keeper's answer: the due date, or today. Absent means today. */
  occurredOn?: string | null;
  now?: Date;
  timeZone?: string;
};

export type ResolvedCompletionTiming = {
  /** Goes in `occurred_at` — when the care happened. */
  occurredAt: string;
  /** Goes in `recorded_at` — when it was written down. Always the real instant. */
  recordedAt: string;
  /** True when the keeper attributed the care to an earlier day than today. */
  backdated: boolean;
};

/**
 * Any day from the due date through today is accepted.
 *
 * This was originally restricted to exactly two answers — the due date or today
 * — on the reasoning that a free date field invites the quiet rewriting the rest
 * of this app refuses to allow. That was too narrow to describe what actually
 * happens: a feeding due Friday and given on Sunday, logged Monday, is true on
 * none of those two days, and forcing it into one of them puts a wrong date in
 * the record to protect against wrong dates.
 *
 * The bounds are what keeps it honest. Nothing later than today, because care
 * that has not happened cannot be recorded; nothing earlier than the due date,
 * because a task finished before it came due was never overdue and is logged on
 * the day like any other. So the window is exactly the span in which the care
 * could have been late, and never a blank calendar.
 */
export function resolveOccurredAt({
  dueDate,
  occurredOn,
  now = new Date(),
  timeZone = DEFAULT_TIME_ZONE,
}: ResolveOccurredAtOptions): ResolvedCompletionTiming {
  const recordedAt = now.toISOString();
  const today = dateInTimeZone(timeZone, now);

  if (occurredOn === undefined || occurredOn === null || occurredOn === today) {
    return { occurredAt: recordedAt, recordedAt, backdated: false };
  }
  if (!isIsoDate(occurredOn)) {
    throw new CompletionTimingError("Completion date must be a calendar date.");
  }
  if (occurredOn > today) {
    throw new CompletionTimingError("A completion cannot be recorded in the future.");
  }
  if (occurredOn < dueDate) {
    throw new CompletionTimingError(
      "A completion cannot be recorded before the day it was due.",
    );
  }

  // Noon UTC lands on the intended calendar day in every time zone from UTC-11
  // to UTC+11, so the stored instant never reads as the day before or after in
  // the household's zone. The clock time is invented either way — the keeper
  // told us the day, not the hour — so it should at least be invented safely.
  return { occurredAt: `${occurredOn}T12:00:00.000Z`, recordedAt, backdated: true };
}

/** True when a task's due date is behind the household's current day. */
export function taskIsOverdue(dueDate: string, now = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  return dueDate < dateInTimeZone(timeZone, now);
}

/**
 * Every calendar day a late completion could honestly be attributed to: the due
 * date (the day it first appeared on the list) through today, inclusive. This is
 * exactly the window `resolveOccurredAt` accepts, surfaced as discrete choices so
 * a grace-window task — on the list Friday, done Saturday, logged Monday — can be
 * marked for the day it was really done instead of only its endpoints.
 *
 * Returns `[]` when today precedes the due date (nothing to backdate), or when
 * the span is longer than `cap` days — a months-old occurrence is better served
 * by a free date field than by a wall of buttons, so the caller falls back to one.
 */
export function completionDayOptions(dueDate: string, today: string, cap = 14): string[] {
  if (!isIsoDate(dueDate) || !isIsoDate(today) || today < dueDate) return [];
  const start = Date.parse(`${dueDate}T12:00:00.000Z`);
  const end = Date.parse(`${today}T12:00:00.000Z`);
  const days = Math.round((end - start) / 86_400_000) + 1;
  if (days > cap) return [];
  return Array.from({ length: days }, (_, index) =>
    new Date(start + index * 86_400_000).toISOString().slice(0, 10),
  );
}
