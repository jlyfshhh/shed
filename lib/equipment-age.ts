export function equipmentAgeDays(installedOn: string | null | undefined, today: string): number | null {
  if (!installedOn || !/^\d{4}-\d{2}-\d{2}$/.test(installedOn) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const elapsed = Date.parse(`${today}T12:00:00Z`) - Date.parse(`${installedOn}T12:00:00Z`);
  if (!Number.isFinite(elapsed)) return null;
  return Math.max(0, Math.floor(elapsed / 86_400_000));
}

export function equipmentAgeLabel(days: number | null): string | null {
  if (days === null) return null;
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} in use`;
  if (days < 60) return `${Math.floor(days / 7)} weeks in use`;
  if (days < 730) return `${Math.floor(days / 30.4375)} months in use`;
  const years = Math.floor(days / 365.25);
  const months = Math.floor((days - years * 365.25) / 30.4375);
  return `${years} year${years === 1 ? "" : "s"}${months ? `, ${months} month${months === 1 ? "" : "s"}` : ""} in use`;
}
