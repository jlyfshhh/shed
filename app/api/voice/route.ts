import Anthropic from "@anthropic-ai/sdk";
import { env } from "cloudflare:workers";
import { ensureDatabase } from "@/db/runtime";
import { dateInTimeZone, DEFAULT_TIME_ZONE } from "@/lib/date";
import {
  createHusbandryToolExecutor,
  loadVoiceAnimalRoster,
} from "@/lib/husbandry-tools";
import { runVoiceAgent, VOICE_MODEL } from "@/lib/voice-agent";

export const dynamic = "force-dynamic";

type VoiceRequest = { text?: unknown };

export async function POST(request: Request) {
  const apiKey = binding("ANTHROPIC_API_KEY");
  const sharedSecret = binding("SHED_VOICE_TOKEN");
  if (!apiKey || !sharedSecret) {
    return spokenError("Shed's voice service isn't configured yet.", 503);
  }

  const suppliedToken = request.headers.get("X-Shed-Token") ?? "";
  if (!(await tokensMatch(suppliedToken, sharedSecret))) {
    return spokenError("Shed couldn't verify this Shortcut.", 401);
  }

  let payload: VoiceRequest;
  try {
    payload = (await request.json()) as VoiceRequest;
  } catch {
    return spokenError("I couldn't read that request. Please try again.", 400);
  }
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!text || text.length > 1_000) {
    return spokenError(
      text.length > 1_000
        ? "That request is too long. Please try a shorter phrase."
        : "Please tell Shed what you want to log or check.",
      400,
    );
  }

  try {
    const timeZone = binding("SHED_TIME_ZONE") ?? DEFAULT_TIME_ZONE;
    const today = dateInTimeZone(timeZone);
    const db = await ensureDatabase(today);
    const roster = await loadVoiceAnimalRoster(db);
    const client = new Anthropic({ apiKey });
    const response = await runVoiceAgent({
      client: client.messages,
      text,
      roster,
      today,
      model: VOICE_MODEL,
      executeTool: createHusbandryToolExecutor({ db, roster, today }),
    });
    return Response.json({ response });
  } catch (error) {
    console.error(
      "[shed voice] request failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return spokenError(
      "I couldn't reach Shed's voice service just now. Please try again.",
      502,
    );
  }
}

function binding(name: string): string | undefined {
  const value = (env as unknown as Record<string, unknown>)[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function tokensMatch(supplied: string, expected: string): Promise<boolean> {
  if (!supplied || !expected) return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function spokenError(response: string, status: number) {
  return Response.json({ response }, { status });
}
