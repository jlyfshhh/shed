import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ApiInputError, internalErrorResponse, safeErrorResponse } from "../lib/api-errors.ts";

test("unexpected backend details are logged but never returned", async () => {
  const secret = "SQLITE_CONSTRAINT at private_table; object-key=hidden-plan-sheet";
  const original = console.error;
  const logged: unknown[][] = [];
  console.error = (...values: unknown[]) => { logged.push(values); };
  try {
    const response = internalErrorResponse(new Error(secret), {
      context: "Synthetic route failed",
      message: "Unable to load this information",
    });
    const body = await response.text();

    assert.equal(response.status, 500);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(JSON.parse(body), { error: "Unable to load this information" });
    assert.equal(body.includes(secret), false);
    assert.equal(String(logged[0]?.[1]).includes(secret), true);
  } finally {
    console.error = original;
  }
});

test("only explicitly classified request errors keep their message", async () => {
  const response = safeErrorResponse(new ApiInputError("Use YYYY-MM-DD"), {
    context: "Synthetic write failed",
    message: "Unable to save",
  });

  assert.equal(response.status, 400);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { error: "Use YYYY-MM-DD" });
});

test("safe error boundary contains an unclassified SQL exception", async () => {
  const secret = "SELECT password_hash FROM household_members";
  const original = console.error;
  console.error = () => {};
  try {
    const response = safeErrorResponse(new Error(secret), {
      context: "Synthetic write failed",
      message: "Unable to save",
      headers: { "X-Test": "preserved" },
    });
    const body = await response.text();

    assert.equal(response.status, 500);
    assert.equal(response.headers.get("X-Test"), "preserved");
    assert.equal(body.includes(secret), false);
    assert.deepEqual(JSON.parse(body), { error: "Unable to save" });
  } finally {
    console.error = original;
  }
});

test("dashboard, profile, week, and owner APIs use the contained error boundary", async () => {
  const routes = [
    "app/api/dashboard/route.ts",
    "app/api/week/route.ts",
    "app/api/animals/[id]/route.ts",
    "app/api/manage/route.ts",
    "app/api/household/members/route.ts",
    "app/api/household/rewards/route.ts",
    "app/api/feeders/bulk/route.ts",
  ];

  for (const route of routes) {
    const source = await readFile(new URL(`../${route}`, import.meta.url), "utf8");
    assert.match(source, /(?:internal|safe)ErrorResponse\(/, `${route} should use the shared boundary`);
    assert.doesNotMatch(source, /error\s+instanceof\s+Error\s*\?\s*error\.message/, `${route} must not return backend messages`);
  }
});
