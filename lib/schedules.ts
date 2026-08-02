import { isIsoDate } from "./date.ts";

export type CareScheduleRow = {
  id: string;
  animalId: string;
  taskType: string;
  title: string;
  details: string;
  frequency: "daily" | "weekly" | "interval" | "monthly" | "once";
  intervalDays: number | null;
  weekdaysJson: string | null;
  dayOfMonth: number | null;
  startDate: string;
  endDate: string | null;
};

export function scheduleIsDue(schedule: CareScheduleRow, date: string): boolean {
  if (!isIsoDate(date) || date < schedule.startDate || (schedule.endDate && date > schedule.endDate)) return false;
  if (schedule.frequency === "daily") return true;
  if (schedule.frequency === "once") return date === schedule.startDate;
  if (schedule.frequency === "interval") {
    const days = schedule.intervalDays ?? 0;
    return days > 0 && daysBetween(schedule.startDate, date) % days === 0;
  }
  if (schedule.frequency === "monthly") {
    const weekdays = parseWeekdays(schedule.weekdaysJson);
    if (!weekdays.length) return Number(date.slice(8, 10)) === schedule.dayOfMonth;
    const day = Number(date.slice(8, 10));
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const occurrence = Math.floor((day - 1) / 7) + 1;
    return weekdays.includes(weekday) && occurrence === schedule.dayOfMonth;
  }
  if (schedule.frequency === "weekly") {
    const weekdays = parseWeekdays(schedule.weekdaysJson);
    return weekdays.includes(new Date(`${date}T12:00:00Z`).getUTCDay());
  }
  return false;
}

export function parseWeekdays(value: string | null): number[] {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6) : [];
  } catch {
    return [];
  }
}

function daysBetween(left: string, right: string): number {
  return Math.round((Date.parse(`${right}T12:00:00Z`) - Date.parse(`${left}T12:00:00Z`)) / 86_400_000);
}
