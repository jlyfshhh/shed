import { isIsoDate } from "./date.ts";

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Every date here is parsed at UTC noon, the same trick the rest of the app
// uses: it keeps a plain YYYY-MM-DD from sliding a day either way when the
// host is behind or ahead of UTC.
function atNoon(date: string): number {
  return Date.parse(`${date}T12:00:00Z`);
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function weekdayIndex(date: string): number {
  return new Date(atNoon(date)).getUTCDay();
}

/** The Sunday on or before `date`. */
export function startOfWeek(date: string): string {
  return toIso(atNoon(date) - weekdayIndex(date) * 86_400_000);
}

export function shiftWeeks(start: string, weeks: number): string {
  return toIso(atNoon(start) + weeks * 7 * 86_400_000);
}

export function addDays(date: string, days: number): string {
  return toIso(atNoon(date) + days * 86_400_000);
}

/** The seven dates of the week containing `date`, Sunday first. */
export function weekDates(date: string): string[] {
  const start = startOfWeek(date);
  return Array.from({ length: 7 }, (_, offset) => addDays(start, offset));
}

/**
 * Resolve the week a request is asking for. Anything unparseable falls back to
 * the week containing `today` rather than erroring — a bad `start` in a URL
 * should show this week, not a broken screen.
 */
export function resolveWeekStart(requested: string | null | undefined, today: string): string {
  if (requested && isIsoDate(requested)) return startOfWeek(requested);
  return startOfWeek(today);
}

export function describeWeek(start: string, today: string): string {
  const thisWeek = startOfWeek(today);
  if (start === thisWeek) return "This week";
  if (start === shiftWeeks(thisWeek, -1)) return "Last week";
  if (start === shiftWeeks(thisWeek, 1)) return "Next week";
  const end = addDays(start, 6);
  const month = (date: string) => new Date(atNoon(date)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const day = (date: string) => Number(date.slice(8, 10));
  return month(start) === month(end)
    ? `${month(start)} ${day(start)}–${day(end)}`
    : `${month(start)} ${day(start)} – ${month(end)} ${day(end)}`;
}
