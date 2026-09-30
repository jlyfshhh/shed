// The care streak: consecutive recent days on which every accountable scheduled
// task was completed. It is the honest, motivating number a keeper can share —
// so it never overclaims. A day is clean when nothing due was missed and
// everything accountable was done; a skipped task is a judgement that care was
// not needed, so it neither breaks the streak nor is required.
//
// Today is special: while today still has care left to do it is "in progress",
// not a broken day, so the streak is measured up to the last settled day and
// today only extends it once it is itself clean.

export type StreakDay = {
  date: string;
  /** Accountable tasks due that day (scheduled minus skipped). */
  accountable: number;
  /** Accountable tasks completed. */
  completed: number;
  /** Accountable tasks explicitly marked missed. */
  missed: number;
};

export type CareStreak = {
  current: number;
  longest: number;
  /** True when today still has accountable care outstanding (streak is "held"). */
  todayInProgress: boolean;
};

function isClean(day: StreakDay): boolean {
  return day.missed === 0 && day.completed >= day.accountable;
}

/**
 * @param days  chronological, one per calendar day, oldest first, ending today.
 * @param today the household's current date (YYYY-MM-DD).
 */
export function careStreak(days: readonly StreakDay[], today: string): CareStreak {
  // Longest run of clean days anywhere in the window.
  let longest = 0;
  let run = 0;
  for (const day of days) {
    run = isClean(day) ? run + 1 : 0;
    if (run > longest) longest = run;
  }

  // Current streak: count clean days backwards from the end. Today, if it is not
  // yet clean but nothing has been missed, is "in progress" — skip it rather
  // than letting an unfinished day read as a broken one.
  const ordered = [...days];
  const last = ordered[ordered.length - 1];
  const todayInProgress = Boolean(last && last.date === today && !isClean(last) && last.missed === 0);
  if (todayInProgress) ordered.pop();

  let current = 0;
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    if (!isClean(ordered[i])) break;
    current += 1;
  }
  return { current, longest: Math.max(longest, current), todayInProgress };
}
