/**
 * Read a JSON object body, or say why not.
 *
 * `JSON.parse` accepts `null`, `true`, `"text"` and `[]` as valid JSON, so a
 * route that goes straight to `payload.something` throws a TypeError on a body
 * of `null` and answers 500. Several routes did, including unauthenticated
 * sign-in, which let any stranger fill the logs with internal errors. A
 * malformed request is the caller's mistake and deserves a 400.
 */
export type JsonBody = Record<string, unknown>;

export async function readJsonObject(request: Request): Promise<
  { body: JsonBody; response?: undefined } | { body?: undefined; response: Response }
> {
  const noStore = { "Cache-Control": "no-store" };
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return { response: Response.json({ error: "This request was not valid JSON." }, { status: 400, headers: noStore }) };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { response: Response.json({ error: "This request needs a JSON object." }, { status: 400, headers: noStore }) };
  }
  return { body: value as JsonBody };
}
