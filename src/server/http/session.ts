import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isIP } from "node:net";
import { loadActor, type Actor } from "../authz/actor";
import { getAuth } from "../auth/auth";
import { appPrisma } from "../db/client";

/** Usuário da requisição atual (telas/Server Components). Uma leitura por requisição. */
export const currentActor = cache(async (): Promise<Actor | null> => {
  const h = await headers();
  const session = await getAuth().api.getSession({ headers: h });
  if (!session) return null;
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  return loadActor(appPrisma(), session.user.id, { ip: ip && isIP(ip) ? ip : null, userAgent: h.get("user-agent") });
});

/** `next`: para onde voltar depois do login (ex.: link de um aviso). */
export async function requireUser(next?: string): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  return actor;
}
