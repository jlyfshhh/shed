import { env } from "cloudflare:workers";

export function binding(name: string): string | undefined {
  const value = (env as unknown as Record<string, unknown>)[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function voiceRequestIsAuthorized(
  request: Request,
  sharedSecret: string,
): Promise<boolean> {
  return tokensMatch(request.headers.get("X-Shed-Token") ?? "", sharedSecret);
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
