import { ensureDatabase } from "@/db/runtime";
import { accessCookie, capabilitiesForRole, createAccessCode, hashAccessCode } from "@/lib/household-auth";
import { createInitialOwner } from "@/lib/bootstrap-owner";
import { binding, sharedSecretIsAuthorized } from "@/lib/env";

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  try {
    const bootstrapToken = binding("SHED_BOOTSTRAP_TOKEN");
    if (!bootstrapToken) {
      return Response.json({ error: "Head Keeper setup is not enabled" }, { status: 503, headers: noStore });
    }
    if (!(await sharedSecretIsAuthorized(request, bootstrapToken, "X-Shed-Bootstrap-Token"))) {
      return Response.json({ error: "Invalid bootstrap token" }, { status: 401, headers: noStore });
    }

    let payload: { displayName?: unknown };
    try {
      const value = await request.json();
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid body");
      payload = value as { displayName?: unknown };
    } catch {
      return Response.json({ error: "A valid setup request is required" }, { status: 400, headers: noStore });
    }
    const displayName = cleanDisplayName(payload.displayName);
    if (!displayName) {
      return Response.json({ error: "Display name is required" }, { status: 400, headers: noStore });
    }

    const id = crypto.randomUUID();
    const accessCode = createAccessCode();
    const accessCodeHash = await hashAccessCode(accessCode);
    const now = new Date().toISOString();
    const db = await ensureDatabase();
    const created = await createInitialOwner(db, { id, displayName, accessCodeHash, timestamp: now });
    if (!created) {
      return Response.json(
        { error: "The Shed household already has an owner" },
        { status: 409, headers: noStore },
      );
    }

    return Response.json(
      {
        capabilities: capabilitiesForRole("Owner"),
        member: { id, displayName, role: "Owner" },
        accessCode,
      },
      { status: 201, headers: { "Set-Cookie": accessCookie(accessCode, request), ...noStore } },
    );
  } catch (error) {
    console.error("Head Keeper setup failed", error);
    return Response.json({ error: "Unable to create the owner" }, { status: 500, headers: noStore });
  }
}

function cleanDisplayName(value: unknown): string | null {
  const cleaned = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return cleaned && cleaned.length <= 40 ? cleaned : null;
}
