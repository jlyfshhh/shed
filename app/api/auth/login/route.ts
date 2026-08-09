import { ensureDatabase } from "@/db/runtime";
import { binding } from "@/lib/env";
import { handleLoginRequest, type LoginMember } from "@/lib/login-route";
import { loginThrottle, trustedProxyIpHeader } from "@/lib/login-throttle";

export async function POST(request: Request) {
  return handleLoginRequest(request, {
    throttle: loginThrottle,
    // Blank by default. Set only when the Shed origin is reachable exclusively
    // through a proxy that strips and overwrites this exact header.
    trustedProxyHeader: trustedProxyIpHeader(binding("SHED_TRUSTED_PROXY_IP_HEADER")),
    openStore: async () => {
      const db = await ensureDatabase();
      return {
        findActiveMember: (accessCodeHash: string) => db.prepare(
          "SELECT id, display_name AS displayName, role FROM household_members WHERE access_code_hash = ? AND active = 1",
        ).bind(accessCodeHash).first<LoginMember>(),
        markLogin: async (memberId: string, timestamp: string) => {
          await db.prepare("UPDATE household_members SET last_login_at = ?, updated_at = ? WHERE id = ?")
            .bind(timestamp, timestamp, memberId).run();
        },
      };
    },
    // Sign-in is reachable with no credentials, so never echo internal errors.
    reportError: (error) => console.error("sign-in failed", error),
  });
}
