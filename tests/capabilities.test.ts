import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  ALL_CAPABILITIES,
  KEEPER_CAPABILITIES,
  authorize,
  capabilitiesForContext,
  capabilitiesForRole,
  roleHasCapability,
  type Capability,
} from "../lib/capabilities.ts";

test("Keeper is read plus completion only and Owner holds the whole matrix", () => {
  assert.deepEqual(KEEPER_CAPABILITIES, ["care.read", "care.complete"]);
  assert.deepEqual(capabilitiesForRole("Zookeeper"), ["care.read", "care.complete"]);
  assert.deepEqual(capabilitiesForRole("Owner"), ALL_CAPABILITIES);

  for (const capability of ALL_CAPABILITIES) {
    assert.equal(roleHasCapability("Owner", capability), true, `Owner should hold ${capability}`);
    assert.equal(
      roleHasCapability("Zookeeper", capability), KEEPER_CAPABILITIES.includes(capability),
      `Keeper policy drifted for ${capability}`,
    );
  }
});

test("authorization returns the same 401/403 boundary for every protected action", () => {
  for (const capability of ALL_CAPABILITIES) {
    assert.deepEqual(
      authorize(capability, { authRequired: true, role: null }),
      { status: 401, error: "Sign in to Shed first" },
    );
    assert.equal(authorize(capability, { authRequired: true, role: "Owner" }), null);
    assert.equal(authorize(capability, { authRequired: false, role: null }), null);

    const keeperDecision = authorize(capability, { authRequired: true, role: "Zookeeper" });
    if (KEEPER_CAPABILITIES.includes(capability)) assert.equal(keeperDecision, null);
    else assert.deepEqual(keeperDecision, { status: 403, error: "Head Keeper access required" });
  }
});

test("effective capabilities cover signed-in and deliberately auth-off installs", () => {
  assert.deepEqual(capabilitiesForContext({ authRequired: true, role: null }), []);
  assert.deepEqual(capabilitiesForContext({ authRequired: true, role: "Zookeeper" }), KEEPER_CAPABILITIES);
  assert.deepEqual(capabilitiesForContext({ authRequired: true, role: "Owner" }), ALL_CAPABILITIES);
  assert.deepEqual(capabilitiesForContext({ authRequired: false, role: null }), ALL_CAPABILITIES);
});

type RoutePolicy = {
  file: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  capabilities: Capability[];
};

// This is intentionally exhaustive. Adding an API route without classifying it
// as session/token/public or tying it to the shared capability gate fails the
// test instead of quietly growing an unreviewed authorization surface.
const PROTECTED_ROUTES: RoutePolicy[] = [
  { file: "app/api/animals/[id]/photo/route.ts", method: "GET", capabilities: ["care.read"] },
  { file: "app/api/animals/[id]/photo/route.ts", method: "POST", capabilities: ["animal.photo.write"] },
  { file: "app/api/animals/[id]/photo/route.ts", method: "DELETE", capabilities: ["animal.photo.write"] },
  { file: "app/api/animals/[id]/route.ts", method: "GET", capabilities: ["care.read"] },
  { file: "app/api/care/copy-routines/route.ts", method: "POST", capabilities: ["records.manage"] },
  { file: "app/api/care/start-fresh/route.ts", method: "POST", capabilities: ["care.startFresh"] },
  { file: "app/api/dashboard/route.ts", method: "GET", capabilities: ["care.read"] },
  { file: "app/api/export/route.ts", method: "GET", capabilities: ["records.export"] },
  { file: "app/api/feeders/bulk/route.ts", method: "POST", capabilities: ["feeders.manage"] },
  { file: "app/api/feeders/forecast/route.ts", method: "GET", capabilities: ["care.read"] },
  { file: "app/api/feeders/order/route.ts", method: "POST", capabilities: ["feeders.manage"] },
  { file: "app/api/feeders/order/route.ts", method: "DELETE", capabilities: ["feeders.manage"] },
  { file: "app/api/feeders/route.ts", method: "GET", capabilities: ["care.read"] },
  { file: "app/api/household/contributions/route.ts", method: "GET", capabilities: ["household.manage"] },
  { file: "app/api/household/members/[id]/payout/route.ts", method: "POST", capabilities: ["household.manage"] },
  { file: "app/api/household/members/[id]/route.ts", method: "PATCH", capabilities: ["household.manage"] },
  { file: "app/api/household/members/route.ts", method: "GET", capabilities: ["household.manage"] },
  { file: "app/api/household/members/route.ts", method: "POST", capabilities: ["household.manage"] },
  { file: "app/api/household/rewards/route.ts", method: "GET", capabilities: ["household.manage"] },
  { file: "app/api/household/rewards/route.ts", method: "PATCH", capabilities: ["household.manage"] },
  { file: "app/api/import/route.ts", method: "POST", capabilities: ["records.manage"] },
  { file: "app/api/lighting/import/route.ts", method: "POST", capabilities: ["lighting.manage"] },
  { file: "app/api/lighting/plans/[id]/sheet/route.ts", method: "GET", capabilities: ["care.read"] },
  { file: "app/api/lighting/plans/[id]/sheet/route.ts", method: "POST", capabilities: ["lighting.manage"] },
  { file: "app/api/lighting/plans/[id]/sheet/route.ts", method: "DELETE", capabilities: ["lighting.manage"] },
  { file: "app/api/manage/route.ts", method: "GET", capabilities: ["records.manage"] },
  { file: "app/api/manage/route.ts", method: "POST", capabilities: ["records.manage"] },
  { file: "app/api/manage/route.ts", method: "PATCH", capabilities: ["records.manage"] },
  { file: "app/api/manage/route.ts", method: "DELETE", capabilities: ["records.manage"] },
  { file: "app/api/tasks/complete/route.ts", method: "POST", capabilities: ["care.complete"] },
  { file: "app/api/tasks/complete/route.ts", method: "PATCH", capabilities: ["care.correct"] },
  { file: "app/api/tasks/complete/route.ts", method: "DELETE", capabilities: ["care.correct"] },
  { file: "app/api/tasks/miss/route.ts", method: "POST", capabilities: ["care.miss", "care.missAll"] },
  // Skipping is a judgement about whether care was needed, made by whoever is
  // doing the care — the same people who complete tasks, not only the Head
  // Keeper. It destroys nothing and is reversible.
  { file: "app/api/tasks/skip/route.ts", method: "POST", capabilities: ["care.complete"] },
  { file: "app/api/tasks/skip/route.ts", method: "DELETE", capabilities: ["care.complete"] },
  { file: "app/api/week/route.ts", method: "GET", capabilities: ["care.read"] },
  { file: "app/api/weights/route.ts", method: "POST", capabilities: ["weights.record"] },
  { file: "app/api/sheds/route.ts", method: "POST", capabilities: ["sheds.record"] },
];

const TOKEN_OR_SESSION_ROUTES = [
  "app/api/auth/bootstrap/route.ts",
  "app/api/auth/login/route.ts",
  "app/api/auth/session/route.ts",
  "app/api/display/route.ts",
  "app/api/health/route.ts",
];

function methodBody(source: string, method: RoutePolicy["method"]): string {
  const marker = `export async function ${method}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${method} handler is missing`);
  const next = source.indexOf("\nexport async function ", start + marker.length);
  return source.slice(start, next === -1 ? undefined : next);
}

test("every API route is classified and every protected method names its capability", async () => {
  const apiRoot = path.join(process.cwd(), "app/api");
  const discovered = (await readdir(apiRoot, { recursive: true }))
    .filter((entry) => entry.endsWith("route.ts"))
    .map((entry) => `app/api/${entry.split(path.sep).join("/")}`)
    .sort();
  const classified = [...new Set([
    ...PROTECTED_ROUTES.map((policy) => policy.file),
    ...TOKEN_OR_SESSION_ROUTES,
  ])].sort();
  assert.deepEqual(discovered, classified, "A route was added or removed without updating the security policy matrix");

  for (const policy of PROTECTED_ROUTES) {
    const source = await readFile(path.join(process.cwd(), policy.file), "utf8");
    assert.doesNotMatch(source, /requireHouseholdMember/, `${policy.file} still uses the legacy role-list gate`);
    const body = methodBody(source, policy.method);
    for (const capability of policy.capabilities) {
      assert.match(
        body,
        new RegExp(`requireCapability\\(request,\\s*db,\\s*[^;]*[\"']${capability.replace(".", "\\.")}[\"']`),
        `${policy.method} ${policy.file} must require ${capability}`,
      );
    }
  }
});
