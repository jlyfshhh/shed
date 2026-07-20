import { ensureDatabase } from "@/db/runtime";
import { binding, voiceRequestIsAuthorized } from "@/lib/voice-auth";

export const dynamic = "force-dynamic";

type VoiceAuditRow = {
  id: string;
  requestedAt: string;
  completedAt: string | null;
  utterance: string;
  status: string;
  model: string;
  toolCallsJson: string;
  responseText: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  userAgent: string | null;
};

export async function GET(request: Request) {
  const sharedSecret = binding("SHED_VOICE_TOKEN");
  if (!sharedSecret) {
    return Response.json({ error: "Shed's voice service isn't configured yet." }, { status: 503 });
  }
  if (!(await voiceRequestIsAuthorized(request, sharedSecret))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const requestedLimit = Number.parseInt(
      new URL(request.url).searchParams.get("limit") ?? "50",
      10,
    );
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 200)
      : 50;
    const db = await ensureDatabase();
    const rows = await db
      .prepare(
        "SELECT id, requested_at AS requestedAt, completed_at AS completedAt, utterance, status, model, tool_calls_json AS toolCallsJson, response_text AS responseText, error_message AS errorMessage, duration_ms AS durationMs, user_agent AS userAgent FROM voice_audit_logs ORDER BY requested_at DESC LIMIT ?",
      )
      .bind(limit)
      .all<VoiceAuditRow>();

    return Response.json({
      logs: rows.results.map(({ toolCallsJson, ...row }) => ({
        ...row,
        toolCalls: parseToolCalls(toolCallsJson),
      })),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load the voice audit log" },
      { status: 500 },
    );
  }
}

function parseToolCalls(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
