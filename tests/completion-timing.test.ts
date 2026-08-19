import assert from "node:assert/strict";
import test from "node:test";

import {
  CompletionTimingError,
  resolveOccurredAt,
  taskIsOverdue,
} from "../lib/completion-timing.ts";

const ZONE = "America/New_York";
// 2026-08-16T18:30Z is 14:30 on the 16th in New York, comfortably inside the day.
const NOW = new Date("2026-08-16T18:30:00.000Z");

test("an on-time completion is stamped with the real instant", () => {
  const timing = resolveOccurredAt({ dueDate: "2026-08-16", now: NOW, timeZone: ZONE });
  assert.equal(timing.occurredAt, NOW.toISOString());
  assert.equal(timing.recordedAt, NOW.toISOString());
  assert.equal(timing.backdated, false);
});

test("choosing today on an overdue task keeps the real instant", () => {
  const timing = resolveOccurredAt({
    dueDate: "2026-08-14",
    occurredOn: "2026-08-16",
    now: NOW,
    timeZone: ZONE,
  });
  assert.equal(timing.occurredAt, NOW.toISOString());
  assert.equal(timing.backdated, false);
});

test("choosing the due date files the care on that day", () => {
  const timing = resolveOccurredAt({
    dueDate: "2026-08-14",
    occurredOn: "2026-08-14",
    now: NOW,
    timeZone: ZONE,
  });
  assert.equal(timing.occurredAt, "2026-08-14T12:00:00.000Z");
  assert.equal(timing.backdated, true);
});

test("the logging instant survives backdating", () => {
  // Without this, choosing "the due date" would destroy the only record of when
  // the entry was actually made.
  const timing = resolveOccurredAt({
    dueDate: "2026-08-14",
    occurredOn: "2026-08-14",
    now: NOW,
    timeZone: ZONE,
  });
  assert.equal(timing.recordedAt, NOW.toISOString());
  assert.notEqual(timing.recordedAt, timing.occurredAt);
});

test("a backdated stamp stays on its own calendar day in the household zone", () => {
  const timing = resolveOccurredAt({
    dueDate: "2026-08-14",
    occurredOn: "2026-08-14",
    now: NOW,
    timeZone: ZONE,
  });
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timing.occurredAt));
  assert.equal(local, "2026-08-14");
});

test("a day between the due date and today is accepted", () => {
  // Due Friday, fed Sunday, logged Monday — true on neither of the two days a
  // pair of buttons could offer.
  const timing = resolveOccurredAt({
    dueDate: "2026-08-14",
    occurredOn: "2026-08-15",
    now: NOW,
    timeZone: ZONE,
  });
  assert.equal(timing.occurredAt, "2026-08-15T12:00:00.000Z");
  assert.equal(timing.backdated, true);
});

test("a day before the due date is refused", () => {
  // Care finished before it came due was never overdue, so it is logged on the
  // day like anything else and never reaches this prompt.
  assert.throws(
    () => resolveOccurredAt({
      dueDate: "2026-08-14",
      occurredOn: "2026-08-13",
      now: NOW,
      timeZone: ZONE,
    }),
    CompletionTimingError,
  );
});

test("a day after today is refused", () => {
  assert.throws(
    () => resolveOccurredAt({
      dueDate: "2026-08-14",
      occurredOn: "2026-08-17",
      now: NOW,
      timeZone: ZONE,
    }),
    CompletionTimingError,
  );
});

test("a malformed date is rejected", () => {
  assert.throws(
    () => resolveOccurredAt({
      dueDate: "2026-08-14",
      occurredOn: "the 14th",
      now: NOW,
      timeZone: ZONE,
    }),
    CompletionTimingError,
  );
});

test("care cannot be filed against a future due date", () => {
  assert.throws(
    () => resolveOccurredAt({
      dueDate: "2026-08-20",
      occurredOn: "2026-08-20",
      now: NOW,
      timeZone: ZONE,
    }),
    CompletionTimingError,
  );
});

test("overdue is judged in the household zone, not UTC", () => {
  // 2026-08-17T02:00Z is still the 16th at 22:00 in New York, so a task due on
  // the 16th is not yet overdue even though UTC has rolled over.
  const lateEvening = new Date("2026-08-17T02:00:00.000Z");
  assert.equal(taskIsOverdue("2026-08-16", lateEvening, ZONE), false);
  assert.equal(taskIsOverdue("2026-08-15", lateEvening, ZONE), true);
});

test("an overdue task completed near midnight still resolves to the local today", () => {
  const lateEvening = new Date("2026-08-17T02:00:00.000Z");
  const timing = resolveOccurredAt({
    dueDate: "2026-08-15",
    occurredOn: "2026-08-16",
    now: lateEvening,
    timeZone: ZONE,
  });
  assert.equal(timing.occurredAt, lateEvening.toISOString());
  assert.equal(timing.backdated, false);
});
