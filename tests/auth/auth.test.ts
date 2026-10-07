import { afterAll, describe, expect, it } from "vitest";
import { actorFor, appDb, authDb, demo, expectStatus, ownerDb } from "../helpers";
import { createAuth } from "@/server/auth/auth";
import { acceptInvitation, previewInvitation } from "@/server/auth/invitations";
import { createInvitation, createParticipant } from "@/modules/participants/participants.service";
import { updateParticipant } from "@/modules/participants/participants.service";
import { DEMO_PASSWORD } from "../../prisma/demo-data";

const d = demo();
const auth$ = authDb();
const app = appDb();
const owner = ownerDb();
afterAll(async () => {
  await Promise.all([auth$.$disconnect(), app.$disconnect(), owner.$disconnect()]);
});

const auth = createAuth({ db: auth$, secret: "x".repeat(40), baseURL: "http://localhost:3000", rateLimit: false });
const uniq = () => Math.random().toString(36).slice(2, 8);

async function signIn(email: string, password: string, ip = "203.0.113.10", a = auth) {
  return a.api.signInEmail({
    body: { email, password },
    headers: new Headers({ "x-forwarded-for": ip, "user-agent": "vitest" }),
    asResponse: true,
  });
}

describe("login", () => {
  it("aceita e-mail e senha corretos e cria sessão", async () => {
    const res = await signIn("joao@rockfestival.dev", DEMO_PASSWORD);
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/session_token=/);
    expect(cookie.toLowerCase()).toContain("httponly");

    const session = await auth.api.getSession({ headers: new Headers({ cookie: cookie.split(";")[0] }) });
    expect(session?.user.email).toBe("joao@rockfestival.dev");
    expect(session?.user).not.toHaveProperty("password");
  });

  it("recusa senha errada e e-mail inexistente com a mesma resposta", async () => {
    const wrong = await signIn("joao@rockfestival.dev", "senha-errada");
    const ghost = await signIn("ninguem@rockfestival.dev", "senha-errada");
    expect(wrong.status).toBe(401);
    expect(ghost.status).toBe(401);
    expect((await wrong.json()).message).toBe((await ghost.json()).message);
  });

  it("não tem cadastro público", async () => {
    const res = await auth.api
      .signUpEmail({ body: { email: `x-${uniq()}@x.dev`, password: "12345678abc", name: "X" }, asResponse: true })
      .catch((e: { status?: string | number }) => e);
    expect(res instanceof Response ? res.status : 400).toBeGreaterThanOrEqual(400);
    expect(await owner.user.count({ where: { email: { startsWith: "x-" } } })).toBe(0);
  });

  it("cenário 9: usuário inativo não entra, mesmo com a senha certa, e fica registrado", async () => {
    const res = await signIn("inativo@rockfestival.dev", DEMO_PASSWORD);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers.get("set-cookie") ?? "").not.toMatch(/session_token=[^;]+/);
    const denied = await owner.auditLog.count({ where: { actorUserId: d.users.inativo!, action: "LOGIN_DENIED" } });
    expect(denied).toBeGreaterThan(0);
  });

  it("desativar o usuário derruba as sessões abertas na hora", async () => {
    const u = await owner.user.create({ data: { email: `desliga-${uniq()}@x.dev`, name: "Desliga" } });
    const { hashPassword } = await import("better-auth/crypto");
    await owner.account.create({
      data: { userId: u.id, accountId: u.id, providerId: "credential", password: await hashPassword("senha-forte-1") },
    });
    const res = await signIn(u.email, "senha-forte-1");
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).not.toBeNull();

    await owner.user.update({ where: { id: u.id }, data: { active: false } });
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
  });

  it("limita tentativas de login por IP", async () => {
    const limited = createAuth({ db: auth$, secret: "y".repeat(40), baseURL: "http://localhost:3000", rateLimit: true });
    // O limite vale para as requisições HTTP (o handler montado em /api/auth).
    const attempt = () =>
      limited.handler(
        new Request("http://localhost:3000/api/auth/sign-in/email", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.7", origin: "http://localhost:3000" },
          body: JSON.stringify({ email: "joao@rockfestival.dev", password: "errada" }),
        }),
      );
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await attempt()).status);
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(5)).toContain(429);
  });
});

describe("convite", () => {
  async function newInvite(email = `convidado-${uniq()}@rockfestival.dev`) {
    const marina = await actorFor(app, "marina");
    const p = await createParticipant(marina, {
      eventId: d.events.rock.id, name: "Convidado", email, role: "OPERACIONAL", teamId: d.teams.estrutura.id,
    });
    const inv = await createInvitation(marina, p.id);
    return { p, inv, email };
  }

  it("pessoa nova define a senha, entra e cai no escopo certo", async () => {
    const { p, inv, email } = await newInvite();
    expect(inv.path).toBe(`/convite/${inv.token}`);
    // O banco guarda só o hash do token.
    expect(await owner.invitation.count({ where: { tokenHash: inv.token } })).toBe(0);

    expect(await previewInvitation(auth$, inv.token)).toMatchObject({ email, hasAccount: false });
    const r = await acceptInvitation(auth$, { token: inv.token, password: "minha-senha-1" });
    expect(r).toMatchObject({ email, newAccount: true });

    const res = await signIn(email, "minha-senha-1");
    expect(res.status).toBe(200);

    const linked = await owner.participant.findUniqueOrThrow({ where: { id: p.id } });
    expect(linked.userId).toBe(r.userId);
    const actor = await actorFor(app, "joao"); // sanity: outro usuário segue com o próprio escopo
    expect(actor.memberships.some((m) => m.participantId === p.id)).toBe(false);
  });

  it("o link vale uma vez só", async () => {
    const { inv } = await newInvite();
    await acceptInvitation(auth$, { token: inv.token, password: "minha-senha-1" });
    await expectStatus(acceptInvitation(auth$, { token: inv.token, password: "outra-senha-2" }), 422);
  });

  it("convite expirado é recusado", async () => {
    const { inv } = await newInvite();
    const { hashToken } = await import("@/lib/tokens");
    await owner.invitation.update({ where: { tokenHash: hashToken(inv.token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expectStatus(acceptInvitation(auth$, { token: inv.token, password: "minha-senha-1" }), 422);
  });

  it("participante desativado depois do convite não consegue aceitar", async () => {
    const { p, inv } = await newInvite();
    const marina = await actorFor(app, "marina");
    await updateParticipant(marina, p.id, { active: false });
    await expectStatus(acceptInvitation(auth$, { token: inv.token, password: "minha-senha-1" }), 422);
  });

  it("quem já tem conta só ganha o novo vínculo; a senha não muda", async () => {
    const paulo = await actorFor(app, "paulo");
    const p = await createParticipant(paulo, {
      eventId: d.events.congresso.id, name: "Ana", email: "ana@rockfestival.dev", role: "OPERACIONAL",
      teamId: d.teams.congressoEletrica.id,
    });
    const inv = await createInvitation(paulo, p.id);
    const r = await acceptInvitation(auth$, { token: inv.token, password: "tentando-trocar" });
    expect(r).toMatchObject({ userId: d.users.ana, newAccount: false });
    expect((await signIn("ana@rockfestival.dev", "tentando-trocar")).status).toBe(401);
    expect((await signIn("ana@rockfestival.dev", DEMO_PASSWORD)).status).toBe(200);

    const ana = await actorFor(app, "ana");
    expect(ana.memberships.map((m) => m.eventId).sort()).toEqual([d.events.rock.id, d.events.congresso.id].sort());
  });

  it("senha curta é recusada", async () => {
    const { inv } = await newInvite();
    await expectStatus(acceptInvitation(auth$, { token: inv.token, password: "123" }), 422);
  });

  it("só quem pode atribuir o papel gera convite", async () => {
    const joao = await actorFor(app, "joao");
    await expectStatus(createInvitation(joao, d.participants.carlos.id), 403);
    const claudia = await actorFor(app, "claudia");
    await expectStatus(createInvitation(claudia, d.participants.rafael.id), 403);
  });
});

describe("domínios", () => {
  const signInAt = (url: string, origin: string) =>
    auth.handler(
      new Request(`${url}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin, cookie: "qualquer=1" },
        body: JSON.stringify({ email: "joao@rockfestival.dev", password: "errada" }),
      }),
    );

  it("aceita login pelo próprio endereço, mesmo que não seja o principal", async () => {
    // Com cookie o Better Auth confere a origem. 401 = passou e chegou a conferir a senha.
    expect((await signInAt("https://www.core360prod.com.br", "https://www.core360prod.com.br")).status).toBe(401);
  });

  it("recusa login vindo de outro site", async () => {
    expect((await signInAt("https://www.core360prod.com.br", "https://site-malicioso.dev")).status).toBe(403);
  });
});
