/**
 * The deliberately small input boundary for Shed's public care card.
 *
 * Do not widen this to DashboardData. The dashboard also knows household
 * identities, rewards, record identifiers, notes, and history. A share image
 * should never need any of those values.
 */
export type ShareCareTask = {
  animalName: string;
  complete: boolean;
  skippedAt?: string | null;
  missedAt?: string | null;
};

export type ShareStatusCardInput = {
  date: string;
  animalCount: number;
  tasks: readonly ShareCareTask[];
  overdue: ReadonlyArray<Pick<ShareCareTask, "animalName">>;
  /** Consecutive days of complete care, if known. A count only — never private. */
  streakDays?: number;
};

export type ShareStatusCardOptions = {
  /** Animal names are private unless the Head Keeper explicitly opts in. */
  includeAnimalNames?: boolean;
};

export type ShareStatusCardModel = {
  date: string;
  animalCount: number;
  scheduled: number;
  completed: number;
  remaining: number;
  missed: number;
  skipped: number;
  overdue: number;
  completionPercent: number;
  status: string;
  animalNames: string[];
  streakDays: number;
};

function safeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function safeDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function safeAnimalName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 48);
}

/**
 * Build the only payload allowed to reach the PNG renderer.
 *
 * The returned object is a whitelist, rather than a copy with fields removed.
 * That makes new private dashboard fields private by default too.
 */
export function buildShareStatusCardModel(
  input: ShareStatusCardInput,
  options: ShareStatusCardOptions = {},
): ShareStatusCardModel {
  const skipped = input.tasks.filter((task) => Boolean(task.skippedAt) && !task.complete);
  const accountable = input.tasks.filter((task) => !task.skippedAt || task.complete);
  const completed = accountable.filter((task) => task.complete);
  const missed = accountable.filter((task) => !task.complete && Boolean(task.missedAt));
  const remaining = accountable.filter((task) => !task.complete && !task.missedAt);
  const completionPercent = accountable.length
    ? Math.round((completed.length / accountable.length) * 100)
    : skipped.length
      ? 100
      : 0;

  let status = "No care was scheduled today.";
  if (input.overdue.length > 0) {
    status = input.overdue.length === 1
      ? "One overdue care item needs attention."
      : `${input.overdue.length} overdue care items need attention.`;
  } else if (remaining.length > 0) {
    status = remaining.length === 1
      ? "One care task remains today."
      : `${remaining.length} care tasks remain today.`;
  } else if (missed.length > 0) {
    status = missed.length === 1
      ? "Today’s list is settled with one missed task."
      : `Today’s list is settled with ${missed.length} missed tasks.`;
  } else if (accountable.length > 0) {
    status = "All scheduled care is complete.";
  } else if (skipped.length > 0) {
    status = "Today’s care list is settled.";
  }

  const animalNames = options.includeAnimalNames
    ? [...new Set(
      [...input.tasks, ...input.overdue]
        .map((task) => safeAnimalName(task.animalName))
        .filter(Boolean),
    )]
    : [];

  return {
    date: safeDate(input.date),
    animalCount: safeCount(input.animalCount),
    scheduled: input.tasks.length,
    completed: completed.length,
    remaining: remaining.length,
    missed: missed.length,
    skipped: skipped.length,
    overdue: input.overdue.length,
    completionPercent,
    status,
    animalNames,
    streakDays: safeCount(input.streakDays ?? 0),
  };
}
