"use client";

import { useState } from "react";
import { SHED_QUALITIES, SHED_QUALITY_LABELS, type ShedQuality } from "@/lib/shed-quality";

// A scan-and-log screen for one animal, reached from a printed enclosure QR
// code (`?animal=<id>`). It gathers several entries — completing due care tasks
// and logging a weight and/or a shed — and commits them in one Save, so a keeper
// standing at the enclosure with a phone records everything in a single pass.
// Dates default to today on the server, so there is no date picker to slow it
// down.

export type QuickLogTask = {
  id: string;
  title: string;
  dueDate: string;
};

type Op = { key: string; kind: "task" | "weight" | "shed"; label: string; run: () => Promise<OpResult> };
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
  canComplete,
  canRecordWeight,
  canRecordShed,
  actorRole,
  onClose,
  onSaved,
}: {
  animal: { id: string; name: string; enclosureName: string | null };
  tasks: QuickLogTask[];
  canComplete: boolean;
  canRecordWeight: boolean;
  canRecordShed: boolean;
  actorRole: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
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
    setBusy(true);
    setError(null);

    const ops: Op[] = [];
    for (const id of checked) {
      const task = tasks.find((candidate) => candidate.id === id);
      if (!task) continue;
      ops.push({
        key: `task:${task.id}`,
        kind: "task",
        label: task.title,
        run: () => postJson("/api/tasks/complete", { taskId: task.id, dueDate: task.dueDate, actorRole, outcome: "done" }),
      });
    }
    if (weightOn) {
      ops.push({
        key: "weight",
        kind: "weight",
        label: `Weight ${gramsValue} g`,
        run: () => postJson("/api/weights", { animalId: animal.id, weightGrams: gramsValue }),
      });
    }
    if (shedOn) {
      ops.push({
        key: "shed",
        kind: "shed",
        label: "Shed",
        run: () => postJson("/api/sheds", { animalId: animal.id, quality, notes: shedNotes.trim() || undefined }),
      });
    }

    const settled = await Promise.all(ops.map(async (op) => ({ op, result: await op.run() })));
    setBusy(false);

    const failed = settled.filter((entry) => !entry.result.ok);
    if (failed.length === 0) {
      onSaved();
      onClose();
      return;
    }

    // Partial failure: drop what landed so a retry can't double-record it, then
    // refresh so completed tasks disappear, and keep the sheet open on the rest.
    const okTaskIds = new Set(settled.filter((e) => e.op.kind === "task" && e.result.ok).map((e) => e.op.key.slice(5)));
    if (okTaskIds.size) setChecked((prev) => new Set([...prev].filter((id) => !okTaskIds.has(id))));
    if (settled.some((e) => e.op.kind === "weight" && e.result.ok)) {
      setWeightOn(false);
      setGrams("");
    }
    if (settled.some((e) => e.op.kind === "shed" && e.result.ok)) {
      setShedOn(false);
      setShedNotes("");
      setQuality("complete");
    }
    onSaved();
    const savedCount = settled.length - failed.length;
    setError(
      `${savedCount ? `Saved ${savedCount}. ` : ""}Couldn’t save: ${failed.map((entry) => entry.op.label).join(", ")}. Try again.`,
    );
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
                        <span>{task.title}</span>
                      </label>
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
                      {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
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
