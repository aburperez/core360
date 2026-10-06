import { isIP } from "node:net";
import { authPrisma } from "@/server/db/client";
import { acceptInvitation } from "@/server/auth/invitations";
import { body, errorResponse } from "@/server/http/handler";

/** Público (sem sessão): quem tem o link define a senha. Depois faz login normal. */
export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const r = await acceptInvitation(authPrisma(), await body(req), { ip: ip && isIP(ip) ? ip : null });
    return Response.json({ data: { email: r.email, newAccount: r.newAccount } });
  } catch (err) {
    return errorResponse(err);
  }
}
