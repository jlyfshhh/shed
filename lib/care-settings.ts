// Care baseline ("start fresh") — added by Claude 2026-07-24 while Codex was out.
// The date Shed begins materializing tasks and (later) scoring from. Null means
// "no baseline set" — the full lookback window is used, matching prior behavior.
// This is the intended anchor for the future husbandry-score / achievements work.

export async function getCareStartDate(db: D1Database): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = 'care_start_date'").first<{ value: string }>();
  const value = row?.value?.trim();
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export async function setCareStartDate(db: D1Database, date: string): Promise<void> {
  await db.prepare(
    "INSERT INTO app_settings (key, value) VALUES ('care_start_date', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).bind(date).run();
}
