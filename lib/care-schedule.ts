export function previousIsoDate(date: string): string {
  return isoDaysAgo(date, 1);
}

export function isoDaysAgo(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

// How many days of past tasks Shed keeps actionable ("overdue") so a keeper can
// still mark something done — or missed — after the day rolls over.
export const CARE_LOOKBACK_DAYS = 14;

export function careLookbackDates(today: string, careStartDate: string | null): string[] {
  return Array.from({ length: CARE_LOOKBACK_DAYS }, (_, index) => isoDaysAgo(today, index))
    .filter((date) => !careStartDate || date >= careStartDate);
}

export function overdueStartDate(today: string, careStartDate: string | null): string {
  const lookbackStart = isoDaysAgo(today, CARE_LOOKBACK_DAYS - 1);
  return careStartDate && careStartDate > lookbackStart ? careStartDate : lookbackStart;
}
