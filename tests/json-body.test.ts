import assert from "node:assert/strict";
import test from "node:test";

import { readJsonObject } from "../lib/json-body.ts";

const post = (raw: string) => new Request("http://shed.local/api/x", { method: "POST", body: raw, headers: { "content-type": "application/json" } });

test("valid JSON that is not an object is refused, not crashed on", async () => {
  // Each of these parses successfully, so a route reading a property off the
  // result throws and answers 500. null was the one seen in the wild.
  for (const raw of ["null", "true", "false", "123", '"text"', "[]", "[1,2]"]) {
    const { body, response } = await readJsonObject(post(raw));
    assert.equal(body, undefined, raw);
    assert.equal(response?.status, 400, raw);
  }
});

test("unparseable and empty bodies are refused", async () => {
  for (const raw of ["{ nope", "", "{"]) {
    const { response } = await readJsonObject(post(raw));
    assert.equal(response?.status, 400, JSON.stringify(raw));
  }
});

test("an object body comes through", async () => {
  const { body, response } = await readJsonObject(post('{"a":1,"b":"two"}'));
  assert.equal(response, undefined);
  assert.deepEqual(body, { a: 1, b: "two" });
});

test("the refusal says nothing internal", async () => {
  const { response } = await readJsonObject(post("null"));
  const payload = await response!.json() as { error: string };
  assert.doesNotMatch(payload.error, /TypeError|undefined|cannot read|stack/i);
  assert.equal(response!.headers.get("Cache-Control"), "no-store");
});
