import type Anthropic from "@anthropic-ai/sdk";

export const VOICE_MODEL = "claude-haiku-4-5-20251001";

export type VoiceAnimal = {
  id: string;
  name: string;
  species: string;
};

export type VoiceToolResult = {
  ok: boolean;
  [key: string]: unknown;
};

export type VoiceToolExecutor = (
  name: string,
  input: Record<string, unknown>,
) => Promise<VoiceToolResult>;

export type VoiceToolAuditEntry = {
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
  result: VoiceToolResult;
  technicalError?: string;
};

type MessageClient = {
  create(
    params: Anthropic.Messages.MessageCreateParamsNonStreaming,
  ): Promise<Anthropic.Messages.Message>;
};

export const voiceTools: Anthropic.Messages.Tool[] = [
  {
    name: "log_husbandry_task",
    description:
      "Record one completed husbandry action for exactly one animal. Call this tool once for each animal and each distinct task mentioned.",
    input_schema: {
      type: "object",
      properties: {
        animal_name: {
          type: "string",
          description: "One exact animal name from the supplied roster.",
        },
        task_type: {
          type: "string",
          description:
            "A short, extensible husbandry category such as feeding, misting, spot-cleaning, temp/humidity check, handling, shed check, water change, or weighing.",
        },
        date: {
          type: "string",
          description: "Completion date in YYYY-MM-DD format. Defaults to today.",
        },
        notes: {
          type: "string",
          description: "Optional useful detail, such as food item or observation.",
        },
      },
      required: ["animal_name", "task_type"],
    },
  },
  {
    name: "get_pending_tasks",
    description:
      "Get incomplete scheduled husbandry tasks, optionally filtered to an exact animal, a species group such as ball pythons, or a broad group such as geckos.",
    input_schema: {
      type: "object",
      properties: {
        animal_name: {
          type: "string",
          description:
            "Optional exact animal name or roster group/species phrase. Omit for every animal.",
        },
        date: {
          type: "string",
          description: "Due date in YYYY-MM-DD format. Defaults to today.",
        },
      },
    },
  },
];

export function buildVoiceSystemPrompt(roster: VoiceAnimal[], today: string): string {
  const grouped = new Map<string, string[]>();
  for (const animal of roster) {
    grouped.set(animal.species, [...(grouped.get(animal.species) ?? []), animal.name]);
  }
  const rosterText = [...grouped.entries()]
    .map(([species, names]) => `- ${species}: ${names.join(", ")}`)
    .join("\n");

  return `You are Shed's voice husbandry assistant. Today is ${today}.

Use tools for every logging or pending-task request. Never claim that data was saved or queried without a successful tool result. Keep the final answer short, natural, and easy for a speaker to read aloud.

Animal roster (the database is authoritative):
${rosterText}

Name-resolution rules:
- Resolve spoken names only against this roster. Minor phonetic or spelling errors may be corrected when there is one clear match.
- Never invent an animal. If a name could refer to multiple animals, ask a brief clarifying question.
- Species or plural groups are valid filters for get_pending_tasks.
- For logging, call log_husbandry_task once per exact animal and once per distinct task. If the user says they misted two named animals and fed one, make three calls.
- If the user refers to a group while logging, expand it only when the roster makes membership deterministic; otherwise ask which animals.
- Group additions are cumulative. For example, "I fed all the ball pythons plus Rhino" means one feeding call for every Ball Python in the roster and one feeding call for Rhino.
- Use open, concise task_type values. Prefer feeding, misting, spot-cleaning, temp/humidity check, handling, shed check, water change, and weighing when they fit.
- Put food items and other specifics in notes.
- Resolve "today" to ${today}.`;
}

export async function runVoiceAgent(options: {
  client: MessageClient;
  text: string;
  roster: VoiceAnimal[];
  today: string;
  executeTool: VoiceToolExecutor;
  onToolResult?: (entry: VoiceToolAuditEntry) => void;
  model?: string;
}): Promise<string> {
  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: options.text },
  ];

  for (let turn = 0; turn < 6; turn += 1) {
    const message = await options.client.create({
      model: options.model ?? VOICE_MODEL,
      // Group logging can require many separate tool calls. Seven animals can exceed
      // 600 output tokens before Claude finishes emitting their structured inputs.
      max_tokens: 2_000,
      system: buildVoiceSystemPrompt(options.roster, options.today),
      tools: voiceTools,
      messages,
    });

    const toolCalls = message.content.filter(
      (block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use",
    );

    if (message.stop_reason !== "tool_use" || toolCalls.length === 0) {
      const spokenText = message.content
        .filter((block): block is Anthropic.Messages.TextBlock => block.type === "text")
        .map((block) => block.text.trim())
        .filter(Boolean)
        .join(" ");
      if (spokenText) return spokenText;
      console.warn(
        `[shed voice] Claude returned no text or tool calls (stop_reason=${message.stop_reason ?? "unknown"})`,
      );
      return "I couldn't finish interpreting that request. Nothing was logged. Please try again.";
    }

    messages.push({
      role: "assistant",
      content: message.content as Anthropic.Messages.ContentBlockParam[],
    });

    const results: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const call of toolCalls) {
      let result: VoiceToolResult;
      let technicalError: string | undefined;
      try {
        result = await options.executeTool(
          call.name,
          call.input as Record<string, unknown>,
        );
      } catch (error) {
        technicalError = error instanceof Error ? error.message : "unknown tool error";
        console.error(`[shed voice] tool ${call.name} failed:`, technicalError);
        result = { ok: false, error: "Shed could not complete that action." };
      }
      try {
        options.onToolResult?.({
          toolUseId: call.id,
          name: call.name,
          input: call.input as Record<string, unknown>,
          result,
          ...(technicalError ? { technicalError } : {}),
        });
      } catch {
        // Auditing must never prevent a husbandry action from completing.
      }
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: JSON.stringify(result),
        is_error: !result.ok,
      });
    }
    messages.push({ role: "user", content: results });
  }

  return "That request took too many steps. Please try saying it a little more simply.";
}
