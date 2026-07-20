import assert from "node:assert/strict";
import test from "node:test";
import { readVoiceText } from "../lib/voice-request.ts";

test("reads the documented JSON voice request", async () => {
  const request = new Request("http://shed.test/api/voice", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "  fed Dracarys  " }),
  });
  assert.equal(await readVoiceText(request), "fed Dracarys");
});

test("reads raw text sent by an Apple Shortcut file body", async () => {
  const request = new Request("http://shed.test/api/voice", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "  what tasks are left today?  ",
  });
  assert.equal(await readVoiceText(request), "what tasks are left today?");
});
