type VoiceRequest = { text?: unknown };

export async function readVoiceText(request: Request): Promise<string> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    const payload = (await request.json()) as VoiceRequest;
    return typeof payload.text === "string" ? payload.text.trim() : "";
  }

  return (await request.text()).trim();
}
