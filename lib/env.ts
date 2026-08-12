import { env } from "cloudflare:workers";
import { configuredBinding } from "@/lib/config-secrets";

export function binding(name: string): string | undefined {
  const value = (env as unknown as Record<string, unknown>)[name];
  return configuredBinding(name, value);
}

export async function sharedSecretIsAuthorized(
  request: Request,
  expected: string,
  headerName: string,
): Promise<boolean> {
  const supplied = request.headers.get(headerName) ?? "";
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
