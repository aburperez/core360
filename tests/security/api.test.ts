import { beforeAll, describe, expect, it } from "vitest";
import { demo, ownerDb } from "../helpers";
import { inject } from "vitest";
import { DEMO_PASSWORD } from "../../prisma/demo-data";

/**
 * Cenário 10: o usuário ignora as telas e chama a API direto, trocando IDs na
 * URL e no corpo. Tudo passa pelos route handlers reais (src/app/api), com
 * sessão de verdade.
 */

process.env.APP_DATABASE_URL = inject("appUrl");
process.env.AUTH_DATABASE_URL = inject("authUrl");
process.env.BETTER_AUTH_SECRET = "z".repeat(40);
process.env.BETTER_AUTH_URL = "http://localhost:3000";

const d = demo();
const BASE = "http://localhost:3000";

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
let routes: Record<string, Record<string, Handler>>;
const cookies: Record<string, string> = {};

async function login(email: string) {
  const { getAuth } = await import("@/server/auth/auth");
  const res = await getAuth().api.signInEmail({ body: { email, password: DEMO_PASSWORD }, asResponse: true });
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

async function call(
  who: string | null,
  method: string,
  route: string,
  path: string,
  params: Record<string, string> = {},
  body?: unknown,
) {
  const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "vitest" };
  if (who) headers.cookie = cookies[who];
  const req = new Request(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const res = await routes[route][method](req, { params: Promise.resolve(params) });
  return { status: res.status, json: (await res.json()) as { data?: unknown; error?: { code: string } } };
}

beforeAll(async () => {
  routes = {
    occurrence: await import("@/app/api/occurrences/[occurrenceId]/route"),
    eventOccurrences: await import("@/app/api/events/[eventId]/occurrences/route"),
    conclude: await import("@/app/api/occurrences/[occurrenceId]/conclude/route"),
    participants: await import("@/app/api/events/[eventId]/participants/route"),
    participant: await import("@/app/api/participants/[participantId]/route"),
    event: await import("@/app/api/events/[eventId]/route"),
    me: await import("@/app/api/me/route"),
  } as unknown as typeof routes;
  for (const [who, email] of [
    ["joao", "joao@rockfestival.dev"],
    ["claudia", "claudia@rockproducoes.dev"],
    ["marina", "marina@rockfestival.dev"],
  ]) {
    cookies[who] = await login(email);
  }
});

describe("Cenário 10: burlar o frontend pela API", () => {
  it("sem sessão: 401 em tudo", async () => {
    const r = await call(null, "GET", "occurrence", "/api/occurrences/x", { occurrenceId: d.occurrences.quadroEletrico.id });
    expect(r.status).toBe(401);
    const forged = await call(null, "GET", "me", "/api/me");
    expect(forged.status).toBe(401);
  });

  it("cookie inventado: 401", async () => {
    cookies.fake = "better-auth.session_token=forjado.assinatura";
    const r = await call("fake", "GET", "me", "/api/me");
    expect(r.status).toBe(401);
  });

  it("Operacional da Elétrica trocando o ID da ocorrência na URL: 404", async () => {
    const own = await call("joao", "GET", "occurrence", "/api/occurrences/x", { occurrenceId: d.occurrences.quadroEletrico.id });
    expect(own.status).toBe(200);
    // (No Congresso o João é Head de Infra, então lá ele vê; aqui é o Rock Festival.)
    for (const id of [d.occurrences.painelCenografia.id, d.occurrences.chopeira.id]) {
      const r = await call("joao", "GET", "occurrence", "/api/occurrences/x", { occurrenceId: id });
      expect(r.status).toBe(404);
    }
  });

  it("Operacional abrindo chamado na Cenografia pela API: 404", async () => {
    const r = await call("joao", "POST", "eventOccurrences", "/api/events/x/occurrences", { eventId: d.events.rock.id }, {
      teamId: d.teams.cenografia.id, title: "Via API",
    });
    expect(r.status).toBe(404);
  });

  it("evento da URL diferente do evento real da equipe: 404", async () => {
    const r = await call("joao", "POST", "eventOccurrences", "/api/events/x/occurrences", { eventId: d.events.congresso.id }, {
      teamId: d.teams.eletrica.id, title: "Mistura de eventos",
    });
    expect(r.status).toBe(404);
  });

  it("listagem filtrada por equipe alheia volta vazia", async () => {
    const r = await call("joao", "GET", "eventOccurrences", `/api/events/x/occurrences?teamId=${d.teams.cenografia.id}`, {
      eventId: d.events.rock.id,
    });
    expect(r.status).toBe(200);
    expect(r.json.data).toEqual([]);
  });

  it("concluir chamado de outra equipe pela API: 404, e nada muda no banco", async () => {
    const r = await call("joao", "POST", "conclude", "/api/occurrences/x/conclude", { occurrenceId: d.occurrences.painelCenografia.id }, {});
    expect(r.status).toBe(404);
    const owner = ownerDb();
    const o = await owner.occurrence.findUniqueOrThrow({ where: { id: d.occurrences.painelCenografia.id } });
    expect(o.status).not.toBe("CONCLUIDO");
    await owner.$disconnect();
  });

  it("Cliente tentando criar Gerente ou Admin pela API: recusado", async () => {
    const asGerente = await call("claudia", "POST", "participants", "/api/events/x/participants", { eventId: d.events.rock.id }, {
      name: "Falso gerente", email: `fg-${Date.now()}@x.dev`, role: "GERENTE",
    });
    expect(asGerente.status).toBe(403);
    const asAdmin = await call("claudia", "POST", "participants", "/api/events/x/participants", { eventId: d.events.rock.id }, {
      name: "Falso admin", email: `fa-${Date.now()}@x.dev`, role: "ADMIN", isAdmin: true,
    });
    expect(asAdmin.status).toBe(422);
  });

  it("Cliente promovendo a si mesma pela API: 403", async () => {
    const r = await call("claudia", "PATCH", "participant", "/api/participants/x", { participantId: d.participants.claudia.id }, {
      role: "GERENTE",
    });
    expect(r.status).toBe(403);
  });

  it("Gerente pedindo evento de outro cliente: 404", async () => {
    const r = await call("marina", "GET", "event", "/api/events/x", { eventId: d.events.congresso.id });
    expect(r.status).toBe(404);
    const ok = await call("marina", "GET", "event", "/api/events/x", { eventId: d.events.rock.id });
    expect(ok.status).toBe(200);
  });

  it("erros não vazam detalhes internos", async () => {
    const r = await call("joao", "GET", "occurrence", "/api/occurrences/x", { occurrenceId: "'; DROP TABLE users; --" });
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.json)).not.toMatch(/prisma|postgres|sql/i);
  });
});
