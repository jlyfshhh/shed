import assert from "node:assert/strict";
import test from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import {
  buildVoiceSystemPrompt,
  runVoiceAgent,
  VOICE_MODEL,
  type VoiceAnimal,
} from "../lib/voice-agent.ts";

const roster: VoiceAnimal[] = [
  { id: "dracarys", name: "Dracarys", species: "Bearded Dragon" },
  { id: "pascal", name: "Pascal", species: "Veiled Chameleon" },
  { id: "wasabi", name: "Wasabi", species: "Panther Chameleon" },
  { id: "telemachus", name: "Telemachus", species: "Ball Python" },
  { id: "achilles", name: "Achilles", species: "Ball Python" },
];

test("fed dracarys today produces the expected logging tool arguments", async () => {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const client = mockClient([
    toolMessage("log-1", "log_husbandry_task", {
      animal_name: "Dracarys",
      task_type: "feeding",
      date: "2026-07-15",
    }),
    textMessage("Dracarys's feeding is logged for today."),
  ]);

  const response = await runVoiceAgent({
    client,
    text: "fed dracarys today",
    roster,
    today: "2026-07-15",
    executeTool: async (name, input) => {
      calls.push({ name, input });
      return { ok: true, saved: true };
    },
  });

  assert.deepEqual(calls, [
    {
      name: "log_husbandry_task",
      input: {
        animal_name: "Dracarys",
        task_type: "feeding",
        date: "2026-07-15",
      },
    },
  ]);
  assert.match(response, /logged/i);
  assert.equal(client.requests[0].model, VOICE_MODEL);
});

test("one utterance may execute multiple husbandry tool calls", async () => {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const client = mockClient([
    multiToolMessage([
      ["log-1", "log_husbandry_task", { animal_name: "Dracarys", task_type: "feeding" }],
      ["log-2", "log_husbandry_task", { animal_name: "Pascal", task_type: "misting" }],
      ["log-3", "log_husbandry_task", { animal_name: "Wasabi", task_type: "misting" }],
    ]),
    textMessage("Feeding and both mistings are logged."),
  ]);

  await runVoiceAgent({
    client,
    text: "I fed Dracarys and misted the chameleons",
    roster,
    today: "2026-07-15",
    executeTool: async (name, input) => {
      calls.push({ name, input });
      return { ok: true, saved: true };
    },
  });

  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((call) => call.input.animal_name), [
    "Dracarys",
    "Pascal",
    "Wasabi",
  ]);
});

test("what is left for ball pythons uses the pending-task tool", async () => {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const client = mockClient([
    toolMessage("query-1", "get_pending_tasks", {
      animal_name: "ball pythons",
      date: "2026-07-15",
    }),
    textMessage("Telemachus and Achilles still need feeding."),
  ]);

  await runVoiceAgent({
    client,
    text: "what's left for the ball pythons",
    roster,
    today: "2026-07-15",
    executeTool: async (name, input) => {
      calls.push({ name, input });
      return { ok: true, count: 2, tasks: [] };
    },
  });

  assert.deepEqual(calls, [
    {
      name: "get_pending_tasks",
      input: { animal_name: "ball pythons", date: "2026-07-15" },
    },
  ]);
});

test("the system prompt derives editable names from the supplied roster", () => {
  const prompt = buildVoiceSystemPrompt(roster, "2026-07-15");
  assert.match(prompt, /Ball Python: Telemachus, Achilles/);
  assert.match(prompt, /database is authoritative/i);
  assert.doesNotMatch(prompt, /Gecko: Echo, Gecko/);
});

function mockClient(responses: Anthropic.Messages.Message[]) {
  const requests: Anthropic.Messages.MessageCreateParamsNonStreaming[] = [];
  return {
    requests,
    async create(request: Anthropic.Messages.MessageCreateParamsNonStreaming) {
      requests.push(request);
      const response = responses.shift();
      if (!response) throw new Error("No mocked Claude response remains");
      return response;
    },
  };
}

function toolMessage(
  id: string,
  name: string,
  input: Record<string, unknown>,
): Anthropic.Messages.Message {
  return message([{ type: "tool_use", id, name, input, caller: { type: "direct" } }], "tool_use");
}

function multiToolMessage(
  calls: Array<[string, string, Record<string, unknown>]>,
): Anthropic.Messages.Message {
  return message(
    calls.map(([id, name, input]) => ({
      type: "tool_use" as const,
      id,
      name,
      input,
      caller: { type: "direct" as const },
    })),
    "tool_use",
  );
}

function textMessage(text: string): Anthropic.Messages.Message {
  return message([{ type: "text", text, citations: null }], "end_turn");
}

function message(
  content: Anthropic.Messages.ContentBlock[],
  stopReason: Anthropic.Messages.StopReason,
): Anthropic.Messages.Message {
  return {
    id: crypto.randomUUID(),
    type: "message",
    role: "assistant",
    model: VOICE_MODEL,
    content,
    stop_reason: stopReason,
    stop_details: null,
    stop_sequence: null,
    container: null,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      cache_creation: null,
      server_tool_use: null,
      service_tier: null,
      inference_geo: null,
      output_tokens_details: null,
    },
  };
}
