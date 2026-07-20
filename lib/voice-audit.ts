import type { ensureDatabase } from "@/db/runtime";
import type { VoiceToolAuditEntry } from "@/lib/voice-agent";

type ShedDatabase = Awaited<ReturnType<typeof ensureDatabase>>;

export async function startVoiceAudit(options: {
  db: ShedDatabase;
  utterance: string;
  model: string;
  requestedAt: string;
  userAgent?: string | null;
}): Promise<string> {
  const id = crypto.randomUUID();
  await options.db
    .prepare(
      "INSERT INTO voice_audit_logs (id, requested_at, utterance, status, model, tool_calls_json, user_agent) VALUES (?, ?, ?, 'processing', ?, '[]', ?)",
    )
    .bind(
      id,
      options.requestedAt,
      options.utterance,
      options.model,
      options.userAgent ?? null,
    )
    .run();
  return id;
}

export async function finishVoiceAudit(options: {
  db: ShedDatabase;
  id: string;
  status: "succeeded" | "failed";
  completedAt: string;
  durationMs: number;
  toolCalls: VoiceToolAuditEntry[];
  responseText: string;
  errorMessage?: string | null;
}): Promise<void> {
  await options.db
    .prepare(
      "UPDATE voice_audit_logs SET completed_at = ?, status = ?, tool_calls_json = ?, response_text = ?, error_message = ?, duration_ms = ? WHERE id = ?",
    )
    .bind(
      options.completedAt,
      options.status,
      JSON.stringify(options.toolCalls),
      options.responseText,
      options.errorMessage ?? null,
      options.durationMs,
      options.id,
    )
    .run();
}
