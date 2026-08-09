export const ACCESS_COOKIE = "shed_access";
// Household phones stay signed in through ordinary care cycles, but a copied
// bearer code must not remain valid in browser storage for a full year.
export const ACCESS_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export function createAccessCode(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const encoded = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  return `shed_${encoded}`;
}

export async function hashAccessCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code.trim()));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function accessCookie(code: string, request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${ACCESS_COOKIE}=${encodeURIComponent(code)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${ACCESS_COOKIE_MAX_AGE}${secure}`;
}

export function expiredAccessCookie(): string {
  return `${ACCESS_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export function accessCodeFromCookie(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === ACCESS_COOKIE) return decodeURIComponent(value.join("="));
  }
  return null;
}
