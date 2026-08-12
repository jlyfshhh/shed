import assert from "node:assert/strict";
import test from "node:test";

import { configuredBinding, isPublishedExampleSecret } from "../lib/config-secrets.ts";

test("the published bootstrap token is never accepted as a credential", () => {
  assert.equal(
    isPublishedExampleSecret(
      "SHED_BOOTSTRAP_TOKEN",
      "replace-with-a-different-long-random-secret",
    ),
    true,
  );
});

test("the published display token is never accepted as a credential", () => {
  assert.equal(
    isPublishedExampleSecret(
      "SHED_DISPLAY_TOKEN",
      "replace-with-a-separate-long-random-secret",
    ),
    true,
  );
});

test("private values and unrelated settings are left alone", () => {
  assert.equal(isPublishedExampleSecret("SHED_BOOTSTRAP_TOKEN", "private-token"), false);
  assert.equal(
    isPublishedExampleSecret("SOME_OTHER_SETTING", "replace-with-a-different-long-random-secret"),
    false,
  );
});

test("the binding layer treats published credentials as unconfigured", () => {
  assert.equal(
    configuredBinding(
      "SHED_BOOTSTRAP_TOKEN",
      "replace-with-a-different-long-random-secret",
    ),
    undefined,
  );
  assert.equal(
    configuredBinding("SHED_DISPLAY_TOKEN", "replace-with-a-separate-long-random-secret"),
    undefined,
  );
  assert.equal(configuredBinding("SHED_DISPLAY_TOKEN", "  private-display-token  "), "private-display-token");
});
