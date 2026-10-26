"use client";

import { useState } from "react";
import { SHED_QUALITIES, SHED_QUALITY_LABELS, type ShedQuality } from "@/lib/shed-quality";
import type { MemberResult } from "@/lib/group-actions";
import {
  quickLogCareDateValid,
  summariseQuickLogSave,
  type QuickLogEntryResult,
  type QuickLogTask,
} from "@/lib/quick-log";

// A scan-and-log screen for one animal, reached from a printed enclosure QR
// code (`?animal=<id>`). It gathers several entries — completing due care tasks
// and logging a weight and/or a shed — and commits them in one Save, so a keeper
// standing at the enclosure with a phone records everything in a single pass.
//
// Care completion is handed back to the host's normal completion path
// (`completeTask`), so a tracked feeding reports the feeder it used or the
// shortage it hit exactly as the Today view does, instead of any HTTP 200
// closing the sheet as full success. A current task is logged as of today; an
// overdue one carries the keeper's answer to "when was this done?", bounded the
// same way the Today timing dialog bounds it, so a late log is never silently
// dated today.

export type { QuickLogTask };

const shortDate = (date: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(
    new Date(`${date}T12:00:00`),
  );

type OpResult = { ok: boolean; error?: string };

async function postJson(url: string, body: Record<string, unknown>): Promise<OpResult> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    return response.ok ? { ok: true } : { ok: false, error: payload.error ?? "Couldn’t save" };
  } catch {
    return { ok: false, error: "Network error" };
  }
}

export function AnimalQuickLog({
  animal,
  tasks,
  today,
  canComplete,
  canRecordWeight,
  canRecordShed,
  completeTask,
  onClose,
  onSaved,
}: {
  animal: { id: string; name: string; enclosureName: string | null };
  tasks: QuickLogTask[];
  today: string;
  canComplete: boolean;
  canRecordWeight: boolean;
  canRecordShed: boolean;
  // Reuses the host's normal completion request, so feeder deduction / shortage
  // detail comes back in the result rather than being thrown away here.
  completeTask: (taskId: string, occurredOn?: string) => Promise<MemberResult>;
  onClose: () => void;
  onSaved: (message?: string, opts?: { slow?: boolean }) => void;
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  // Per overdue task, the keeper's answer to "when was this done?" (defaults to
  // the due date — care logged late is attributed to when it was actually due
  // unless the keeper says otherwise).
  const [careDates, setCareDates] = useState<Record<string, string>>({});
  const [weightOn, setWeightOn] = useState(false);
  const [grams, setGrams] = useState("");
  const [shedOn, setShedOn] = useState(false);
  const [quality, setQuality] = useState<ShedQuality>("complete");
  const [shedNotes, setShedNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleTask = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const careDateFor = (task: QuickLogTask) => careDates[task.id] ?? task.dueDate;
  const setCareDate = (id: string, value: string) => setCareDates((prev) => ({ ...prev, [id]: value }));

  const gramsValue = Number(grams);
  const weightValid = !weightOn || (Number.isFinite(gramsValue) && gramsValue > 0);
  const entryCount = checked.size + (weightOn ? 1 : 0) + (shedOn ? 1 : 0);

  const save = async () => {
    if (!entryCount) {
      onClose();
      return;
    }
    if (weightOn && !weightValid) {
      setError("Enter a weight in grams, or remove the weight entry.");
      return;
    }
    const checkedTasks = tasks.filter((task) => checked.has(task.id));
    const badTiming = checkedTasks.find((task) => !quickLogCareDateValid(task, careDateFor(task), today));
    if (badTiming) {
      setError(`Pick when ${badTiming.title} was done — between its due date and today.`);
      return;
    }
    setBusy(true);
    setError(null);

    type Settled = { kind: "task" | "weight" | "shed"; id?: string; result: QuickLogEntryResult };
    const jobs: Array<Promise<Settled>> = [];

    for (const task of checkedTasks) {
      const occurredOn = task.overdue ? careDateFor(task) : undefined;
      jobs.push(
        completeTask(task.id, occurredOn).then((result): Settled => ({
          kind: "task",
          id: task.id,
          result: result.ok
            ? { ok: true, note: result.note, shortage: result.shortage, slow: result.slow }
            : { ok: false, label: task.title, error: result.error },
        })),
      );
    }
    if (weightOn) {
      jobs.push(
        postJson("/api/weights", { animalId: animal.id, weightGrams: gramsValue }).then((r): Settled => ({
          kind: "weight",
          result: r.ok ? { ok: true, note: `Weight ${gramsValue} g logged` } : { ok: false, label: "Weight", error: r.error ?? "Couldn’t save" },
        })),
      );
    }
    if (shedOn) {
      jobs.push(
        postJson("/api/sheds", { animalId: animal.id, quality, notes: shedNotes.trim() || undefined }).then((r): Settled => ({
          kind: "shed",
          result: r.ok ? { ok: true, note: "Shed logged" } : { ok: false, label: "Shed", error: r.error ?? "Couldn’t save" },
        })),
      );
    }

    const settled = await Promise.all(jobs);
    setBusy(false);
    const summary = summariseQuickLogSave(settled.map((entry) => entry.result));

    if (summary.allSaved) {
      // The host shows the summary (feeder/shortage detail included) and
      // refreshes both the dashboard and the feeder forecast.
      onSaved(summary.message, { slow: summary.slow });
      onClose();
      return;
    }

    // Partial failure: drop what landed so a retry can't double-record it, then
    // refresh so completed care disappears, and keep the sheet open on the rest.
    const okTaskIds = new Set(
      settled.filter((entry) => entry.kind === "task" && entry.result.ok).map((entry) => entry.id as string),
    );
    if (okTaskIds.size) {
      setChecked((prev) => new Set([...prev].filter((id) => !okTaskIds.has(id))));
      setCareDates((prev) => {
        const next = { ...prev };
        for (const id of okTaskIds) delete next[id];
        return next;
      });
    }
    if (settled.some((entry) => entry.kind === "weight" && entry.result.ok)) {
      setWeightOn(false);
      setGrams("");
    }
    if (settled.some((entry) => entry.kind === "shed" && entry.result.ok)) {
      setShedOn(false);
      setShedNotes("");
      setQuality("complete");
    }
    // Hand the host the same summary a full save gets, so a saved-with-a-shortage
    // feeding still surfaces its warning (the row that carried it has just been
    // removed from the retry set), and keep the sheet open showing what failed.
    onSaved(summary.message, { slow: summary.slow });
    setError(summary.message);
  };

  const hasLogOptions = canRecordWeight || canRecordShed;

  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quicklog-title"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="sheet quicklog" onClick={(event) => event.stopPropagation()}>
        <header className="sheet-head">
          <div>
            <h2 id="quicklog-title">Log · {animal.name}</h2>
            {animal.enclosureName && <small>{animal.enclosureName}</small>}
          </div>
          <button type="button" className="sheet-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="sheet-body">
          {canComplete && (
            <section className="quicklog-section">
              <h3>Due care</h3>
              {tasks.length ? (
                <ul className="quicklog-tasks">
                  {tasks.map((task) => (
                    <li key={task.id}>
                      <label className="quicklog-check">
                        <input type="checkbox" checked={checked.has(task.id)} onChange={() => toggleTask(task.id)} />
                        <span>
                          {task.title}
                          {task.showDueDate && (
                            <small className="quicklog-due"> · due {shortDate(task.dueDate)}</small>
                          )}
                        </span>
                      </label>
                      {task.overdue && checked.has(task.id) && (
                        <div className="quicklog-when">
                          <label className="quicklog-field">
                            <span>When was this done?</span>
                            <input
                              type="date"
                              min={task.dueDate}
                              max={today}
                              value={careDateFor(task)}
                              onChange={(event) => setCareDate(task.id, event.target.value)}
                            />
                          </label>
                          <small className="quicklog-muted">
                            This was due {shortDate(task.dueDate)}. Any day through today is fine.
                          </small>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="quicklog-muted">Nothing due right now.</p>
              )}
            </section>
          )}

          {hasLogOptions && (
            <section className="quicklog-section">
              <h3>Log</h3>

              {canRecordWeight &&
                (weightOn ? (
                  <div className="quicklog-entry">
                    <label className="quicklog-field">
                      <span>Weight (g)</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.1"
                        value={grams}
                        onChange={(event) => setGrams(event.target.value)}
                        autoFocus
                      />
                    </label>
                    <button
                      type="button"
                      className="quicklog-remove"
                      onClick={() => {
                        setWeightOn(false);
                        setGrams("");
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <button type="button" className="quicklog-add" onClick={() => setWeightOn(true)}>
                    + Weight
                  </button>
                ))}

              {canRecordShed &&
                (shedOn ? (
                  <div className="quicklog-entry">
                    <label className="quicklog-field">
                      <span>Shed</span>
                      <select value={quality} onChange={(event) => setQuality(event.target.value as ShedQuality)}>
                        {SHED_QUALITIES.map((value) => (
                          <option key={value} value={value}>
                            {SHED_QUALITY_LABELS[value]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="quicklog-field">
                      <span>Notes</span>
                      <input
                        type="text"
                        placeholder="Optional"
                        value={shedNotes}
                        onChange={(event) => setShedNotes(event.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="quicklog-remove"
                      onClick={() => {
                        setShedOn(false);
                        setShedNotes("");
                        setQuality("complete");
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <button type="button" className="quicklog-add" onClick={() => setShedOn(true)}>
                    + Shed
                  </button>
                ))}
            </section>
          )}

          {error && (
            <p className="quicklog-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="sheet-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={busy || entryCount === 0} onClick={save}>
            {busy ? "Saving…" : entryCount ? `Save ${entryCount} ${entryCount === 1 ? "entry" : "entries"}` : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
