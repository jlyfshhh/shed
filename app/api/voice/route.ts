import Anthropic from "@anthropic-ai/sdk";
import { ensureDatabase } from "@/db/runtime";
import { dateInTimeZone, DEFAULT_TIME_ZONE } from "@/lib/date";
import {
  createHusbandryToolExecutor,
  loadVoiceAnimalRoster,
} from "@/lib/husbandry-tools";
import { runVoiceAgent, VOICE_MODEL } from "@/lib/voice-agent";
import type { VoiceToolAuditEntry } from "@/lib/voice-agent";
import { finishVoiceAudit, startVoiceAudit } from "@/lib/voice-audit";
import { binding, voiceRequestIsAuthorized } from "@/lib/voice-auth";
import { readVoiceText } from "@/lib/voice-request";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const startedAt = Date.now();
  const apiKey = binding("ANTHROPIC_API_KEY");
  const sharedSecret = binding("SHED_VOICE_TOKEN");
  if (!apiKey || !sharedSecret) {
    return spokenError("Shed's voice service isn't configured yet.", 503);
  }

  if (!(await voiceRequestIsAuthorized(request, sharedSecret))) {
    return spokenError("Shed couldn't verify this Shortcut.", 401);
  }

  let text: string;
  try {
    text = await readVoiceText(request);
  } catch {
    return spokenError("I couldn't read that request. Please try again.", 400);
  }
  if (!text || text.length > 1_000) {
    return spokenError(
      text.length > 1_000
        ? "That request is too long. Please try a shorter phrase."
        : "Please tell Shed what you want to log or check.",
      400,
    );
  }

  const timeZone = binding("SHED_TIME_ZONE") ?? DEFAULT_TIME_ZONE;
  const today = dateInTimeZone(timeZone);
  const toolCalls: VoiceToolAuditEntry[] = [];
  let db: Awaited<ReturnType<typeof ensureDatabase>> | undefined;
  let auditId: string | undefined;

  try {
    db = await ensureDatabase(today);
    try {
      auditId = await startVoiceAudit({
        db,
        utterance: text,
        model: VOICE_MODEL,
        requestedAt: new Date(startedAt).toISOString(),
        userAgent: request.headers.get("User-Agent"),
      });
    } catch (auditError) {
      console.error("[shed voice audit] unable to start:", errorMessage(auditError));
    }

    const roster = await loadVoiceAnimalRoster(db);
    const client = new Anthropic({ apiKey });
    const response = await runVoiceAgent({
      client: client.messages,
      text,
      roster,
      today,
      model: VOICE_MODEL,
      executeTool: createHusbandryToolExecutor({ db, roster, today }),
      onToolResult: (entry) => toolCalls.push(entry),
    });
    const durationMs = Date.now() - startedAt;
    if (auditId) {
      try {
        await finishVoiceAudit({
          db,
          id: auditId,
          status: "succeeded",
          completedAt: new Date().toISOString(),
          durationMs,
          toolCalls,
          responseText: response,
        });
      } catch (auditError) {
        console.error("[shed voice audit] unable to finish:", errorMessage(auditError));
      }
    }
    console.info(`[shed voice] ${auditId ?? "untracked"} succeeded in ${durationMs}ms`);
    return Response.json({ response });
  } catch (error) {
    const response = "I couldn't reach Shed's voice service just now. Please try again.";
    const durationMs = Date.now() - startedAt;
    if (db && auditId) {
      try {
        await finishVoiceAudit({
          db,
          id: auditId,
          status: "failed",
          completedAt: new Date().toISOString(),
          durationMs,
          toolCalls,
          responseText: response,
          errorMessage: errorMessage(error),
        });
      } catch (auditError) {
        console.error("[shed voice audit] unable to record failure:", errorMessage(auditError));
      }
    }
    console.error(
      "[shed voice] request failed:",
      errorMessage(error),
    );
    return spokenError(response, 502);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function spokenError(response: string, status: number) {
  return Response.json({ response }, { status });
}
