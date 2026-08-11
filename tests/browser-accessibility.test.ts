import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dialogKeyAction } from "../lib/dialog-accessibility.ts";
import { CONTENT_SECURITY_POLICY, SECURITY_HEADERS } from "../security-headers.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("security headers cover the complete browser boundary", () => {
  const headers = new Map(SECURITY_HEADERS.map(({ key, value }) => [key, value]));
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(headers.get("X-Frame-Options"), "DENY");
  assert.equal(headers.get("Referrer-Policy"), "no-referrer");
  assert.match(headers.get("Permissions-Policy") ?? "", /camera=\(\)/);
  assert.match(CONTENT_SECURITY_POLICY, /frame-ancestors 'none'/);
  assert.match(CONTENT_SECURITY_POLICY, /frame-src 'none'/);
  assert.match(CONTENT_SECURITY_POLICY, /object-src 'none'/);
  assert.match(CONTENT_SECURITY_POLICY, /connect-src 'self'/);
  assert.doesNotMatch(CONTENT_SECURITY_POLICY, /unsafe-eval|https?:\/\//);
  assert.match(source("next.config.ts"), /source: "\/\(\.\*\)"/);
});

test("dialog keyboard behavior closes and wraps focus", () => {
  assert.equal(dialogKeyAction("Escape", false, 1, 3), "close");
  assert.equal(dialogKeyAction("Tab", false, 2, 3), "first");
  assert.equal(dialogKeyAction("Tab", true, 0, 3), "last");
  assert.equal(dialogKeyAction("Tab", false, -1, 0), "dialog");
  assert.equal(dialogKeyAction("ArrowDown", false, 1, 3), "none");
});

test("dialog manager isolates background and restores the opener", () => {
  const manager = source("app/dialog-accessibility.tsx");
  assert.match(manager, /sibling\.inert = true/);
  assert.match(manager, /data-modal-live/);
  assert.match(manager, /document\.body\.style\.overflow = top \? "hidden"/);
  assert.match(manager, /opener\?\.isConnected/);
  assert.match(manager, /opener\.focus\(\{ preventScroll: true \}\)/);
  assert.match(manager, /MutationObserver/);
  assert.match(manager, /document\.addEventListener\("keydown", onKey, true\)/);
  assert.match(source("app/layout.tsx"), /<DialogAccessibilityManager \/>/);
});

test("search, progress, viewport, and social metadata are accessible and stable", () => {
  const app = source("app/HusbandryApp.tsx");
  const manage = source("app/manage.tsx");
  const layout = source("app/layout.tsx");
  assert.match(app, /<input type="search"/);
  assert.match(app, /role="status" aria-live="polite" data-modal-live/);
  assert.match(app, /className="sr-only">Search animals/);
  assert.match(app, /role="progressbar"/);
  assert.match(app, /aria-valuenow=\{completionPercent\}/);
  assert.match(manage, /role="progressbar"/);
  assert.match(layout, /initial-scale=1, viewport-fit=cover/);
  assert.doesNotMatch(layout, /maximum-scale|user-scalable=no/);
  assert.match(layout, /openGraph: \{[^}]*url: projectUrl/);
  assert.match(layout, /https:\/\/animalroom\.app\/shed\/og\.png/);
  assert.doesNotMatch(layout, /x-forwarded-host|requestHeaders/);
});
