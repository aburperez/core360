import { isIP } from "node:net";
import { loadActor, type Actor } from "../authz/actor";
import { getAuth } from "../auth/auth";
import { appPrisma } from "../db/client";
import { AppError, UnauthenticatedError } from "../errors";

function clientIp(req: Request): string | null {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip");
  return ip && isIP(ip) ? ip : null;
}

/**
 * Identifica quem chamou a API. A sessão é relida no banco a cada requisição,
 * e o usuário precisa estar ativo; o resto (papéis, escopo) vem do banco.
 */
export async function requireActor(req: Request): Promise<Actor> {
  const session = await getAuth().api.getSession({ headers: req.headers });
  if (!session) throw new UnauthenticatedError();
  const actor = await loadActor(appPrisma(), session.user.id, {
    ip: clientIp(req),
    userAgent: req.headers.get("user-agent"),
  });
  if (!actor) throw new UnauthenticatedError("Usuário inativo");
  return actor;
}

export function errorResponse(err: unknown): Response {
  if (err instanceof AppError) {
    return Response.json({ error: { code: err.code, message: err.message, details: err.details } }, { status: err.status });
  }
  console.error(err);
  return Response.json({ error: { code: "INTERNAL", message: "Erro interno" } }, { status: 500 });
}

type Params = Record<string, string>;
type Ctx<P extends Params> = { params: Promise<P> };

/** Rota autenticada: resolve o usuário, chama o serviço e traduz erros. */
export function authed<P extends Params = Params>(
  fn: (args: { req: Request; actor: Actor; params: P }) => Promise<unknown>,
  opts: { status?: number } = {},
) {
  return async (req: Request, ctx: Ctx<P>): Promise<Response> => {
    try {
      const actor = await requireActor(req);
      const params = ((await ctx?.params) ?? {}) as P;
      const result = await fn({ req, actor, params });
      return Response.json({ data: result }, { status: opts.status ?? 200 });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** Corpo JSON; corpo inválido vira objeto vazio e falha na validação. */
export async function body(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export const query = (req: Request) => Object.fromEntries(new URL(req.url).searchParams);
