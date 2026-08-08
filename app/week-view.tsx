"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

// Seven columns of full task lists is a glance on a desktop and a very long
// scroll on a phone — Sunday alone can fill the screen. Below this width each
// day collapses to its counts and opens on tap, which is the "at a glance" part.
const NARROW = "(max-width: 620px)";
function subscribeToNarrow(callback: () => void) {
  const query = window.matchMedia(NARROW);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
function readNarrow() {
  return window.matchMedia(NARROW).matches;
}

type WeekTask = {
  id: string;
  animalName: string;
  taskType: string;
  title: string;
  complete: number;
  completedBy: string | null;
  missedAt: string | null;
};

type WeekDay = {
  date: string;
  weekday: string;
  dayOfMonth: number;
  isToday: boolean;
  isPast: boolean;
  isFuture: boolean;
  tasks: WeekTask[];
  counts: { total: number; done: number; missed: number; pending: number };
};

type WeekData = {
  start: string;
  end: string;
  today: string;
  label: string;
  isCurrentWeek: boolean;
  previousStart: string;
  nextStart: string;
  days: WeekDay[];
  totals: { total: number; done: number; missed: number; pending: number };
};

const TASK_GLYPHS: Record<string, string> = {
  feeding: "🍽",
  misting: "💧",
  "water bowl cleaning": "🪣",
  maintenance: "🧹",
  lighting: "💡",
  equipment: "🔧",
  weight: "⚖️",
};

function dayState(day: WeekDay): string {
  if (day.isFuture) return "ahead";
  if (!day.counts.total) return "empty";
  if (day.counts.missed) return "missed";
  return day.counts.pending ? "pending" : "done";
}

export default function WeekView({ onClose }: { onClose: () => void }) {
  const [start, setStart] = useState<string | null>(null);
  const [data, setData] = useState<WeekData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openDay, setOpenDay] = useState<string | null>(null);
  // Server render assumes wide: a phone corrects itself on hydration, whereas
  // guessing narrow would collapse every day on a desktop for a frame.
  const narrow = useSyncExternalStore(subscribeToNarrow, readNarrow, () => false);

  // Paging is driven from the handler rather than the effect, so the spinner
  // turns on with the click instead of a render later.
  const goToWeek = useCallback((next: string | null) => {
    setLoading(true);
    setStart(next);
  }, []);

  useEffect(() => {
    // Weeks can be paged faster than the network answers. Without this guard an
    // earlier request landing late would overwrite the week now on screen.
    let cancelled = false;
    fetch(start ? `/api/week?start=${start}` : "/api/week")
      .then(async (response) => {
        const payload = (await response.json()) as WeekData & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Unable to load the week");
        if (cancelled) return;
        setData(payload);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load the week");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [start]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      // Arrow keys page through weeks, which is the whole point of the screen.
      if (event.key === "ArrowLeft" && data) goToWeek(data.previousStart);
      if (event.key === "ArrowRight" && data) goToWeek(data.nextStart);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [data, goToWeek, onClose]);

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="The week at a glance">
      <header className="overlay-head">
        <div>
          <b>{data?.label ?? "The week"}</b>
          <span>{data ? `${data.totals.done} of ${data.totals.total} done` : "Loading…"}</span>
        </div>
        <div className="overlay-head-actions">
          <button className="week-step" onClick={() => data && goToWeek(data.previousStart)} aria-label="Previous week">←</button>
          {!data?.isCurrentWeek && <button className="week-button" onClick={() => goToWeek(null)}>This week</button>}
          <button className="week-step" onClick={() => data && goToWeek(data.nextStart)} aria-label="Next week">→</button>
          <button className="sheet-close" onClick={onClose} aria-label="Close the week view">✕</button>
        </div>
      </header>

      <div className="overlay-body week-body">
        {error && <p className="week-error">{error}</p>}
        {loading && !data && <div className="week-loading"><div className="loader" /><p>Building the week…</p></div>}

        {data && (
          <>
            <div className="week-grid" aria-busy={loading}>
              {data.days.map((day) => (
                <section key={day.date} className={`week-day ${dayState(day)}${day.isToday ? " today" : ""}${narrow && openDay !== day.date ? " collapsed" : ""}`}>
                  {narrow ? (
                    <button
                      className="week-day-head"
                      aria-expanded={openDay === day.date}
                      onClick={() => setOpenDay(openDay === day.date ? null : day.date)}
                    >
                      <div>
                        <span className="week-day-name">{day.weekday}</span>
                        <span className="week-day-num">{day.dayOfMonth}</span>
                      </div>
                      <span className="week-day-summary">
                        {day.counts.total === 0
                          ? (day.isFuture ? "Nothing scheduled" : "Nothing was due")
                          : day.isFuture
                            ? `${day.counts.total} scheduled`
                            : `${day.counts.done}/${day.counts.total} done${day.counts.missed ? ` · ${day.counts.missed} missed` : ""}`}
                      </span>
                      {day.isToday && <span className="week-today-flag">Today</span>}
                      {day.counts.total > 0 && <span className="week-caret" aria-hidden="true">{openDay === day.date ? "▾" : "▸"}</span>}
                    </button>
                  ) : (
                    <header className="week-day-head">
                      <div>
                        <span className="week-day-name">{day.weekday}</span>
                        <span className="week-day-num">{day.dayOfMonth}</span>
                      </div>
                      {day.isToday && <span className="week-today-flag">Today</span>}
                    </header>
                  )}

                  {narrow && openDay !== day.date ? null : day.counts.total === 0 ? (
                    <p className="week-none">{day.isFuture ? "Nothing scheduled" : "Nothing was due"}</p>
                  ) : (
                    <>
                      <ul className="week-tasks">
                        {day.tasks.map((task) => (
                          <li
                            key={task.id}
                            className={task.complete ? "done" : task.missedAt ? "missed" : ""}
                            title={task.completedBy ? `${task.title} — ${task.completedBy}` : task.title}
                          >
                            <span className="week-glyph" aria-hidden="true">{TASK_GLYPHS[task.taskType] ?? "•"}</span>
                            <span className="week-animal">{task.animalName}</span>
                            <span className="week-title">{task.title}</span>
                          </li>
                        ))}
                      </ul>
                      {!narrow && <footer className="week-day-foot">
                        {day.isFuture
                          ? `${day.counts.total} scheduled`
                          : `${day.counts.done}/${day.counts.total} done${day.counts.missed ? ` · ${day.counts.missed} missed` : ""}`}
                      </footer>}
                    </>
                  )}
                </section>
              ))}
            </div>

            <p className="week-note">
              {data.isCurrentWeek
                ? "Tap Today to record care — this view is a read-only overview."
                : data.start > data.today
                  ? "Scheduled from your care plans. Nothing here is recorded yet."
                  : "What was on the list, and who recorded it."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
