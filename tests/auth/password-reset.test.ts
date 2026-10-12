import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "better-auth/crypto";
import { authDb, ownerDb } from "../helpers";
import { createAuth } from "@/server/auth/auth";
import { memoryMailer } from "@/server/email/email";

/**
 * "Esqueci minha senha": o link vai por e-mail, vale 1 hora e uma vez só, e a
 * resposta é sempre a mesma, exista o e-mail ou não. Trocar a senha derruba
 * as sessões e fica na auditoria.
 */

const auth$ = authDb();
const owner = ownerDb();
const mail = memoryMailer();
const BASE = "http://localhost:3000";
const APP = "https://app.core360.test";
const auth = createAuth({ db: auth$, secret: "z".repeat(40), baseURL: BASE, appUrl: APP, rateLimit: false, mailer: () => mail });
const uniq = () => Math.random().toString(36).slice(2, 8);

const call = (path: string, body: unknown, a = auth, extra: Record<string, string> = {}) =>
  a.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": "203.0.113.20", "user-agent": "vitest", ...extra },
      body: JSON.stringify(body),
    }),
  );

let email: string;
let userId: string;
let inactive: string;

async function person(prefix: string, active = true) {
  const e = `${prefix}-${uniq()}@reset.dev`;
  const u = await owner.user.create({ data: { email: e, name: "Paula Souza", active } });
  await owner.account.create({ data: { userId: u.id, accountId: u.id, providerId: "credential", password: await hashPassword("senha-antiga-1") } });
  return { email: e, id: u.id };
}

/** Pede o link e devolve o token do e-mail que chegou. */
async function requestToken(to = email) {
  const before = mail.sent.length;
  const res = await call("/request-password-reset", { email: to });
  expect(res.status).toBe(200);
  expect(mail.sent.length).toBe(before + 1);
  const msg = mail.sent.at(-1)!;
  const url = new URL(msg.text.split("\n").find((l) => l.startsWith("http"))!);
  return { msg, url, token: url.searchParams.get("token")! };
}

beforeAll(async () => {
  ({ email, id: userId } = await person("paula"));
  inactive = (await person("inativa", false)).email;
});

afterAll(async () => {
  await Promise.all([auth$.$disconnect(), owner.$disconnect()]);
});

describe("pedir o link", () => {
  it("manda o e-mail com o link do app, sem dizer se a conta existe", async () => {
    const { msg, url } = await requestToken();
    expect(msg.to).toBe(email);
    expect(msg.subject).toBe("Criar uma nova senha no CORE 360");
    expect(msg.html).toContain("Olá, Paula.");
    expect(`${url.origin}${url.pathname}`).toBe(`${APP}/redefinir-senha`);

    const known = await call("/request-password-reset", { email });
    const ghost = await call("/request-password-reset", { email: `ninguem-${uniq()}@reset.dev` });
    const off = await call("/request-password-reset", { email: inactive });
    const bodies = await Promise.all([known, ghost, off].map((r) => r.json()));
    expect([known.status, ghost.status, off.status]).toEqual([200, 200, 200]);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
  });

  it("conta inexistente ou desativada não recebe nada", async () => {
    const before = mail.sent.length;
    await call("/request-password-reset", { email: `ninguem-${uniq()}@reset.dev` });
    await call("/request-password-reset", { email: inactive });
    expect(mail.sent.length).toBe(before);
  });

  it("o link usa o endereço do app, mesmo se o pedido vier com outro Host", async () => {
    const before = mail.sent.length;
    await call("/request-password-reset", { email }, auth, { host: "site-falso.example", "x-forwarded-host": "site-falso.example" });
    expect(mail.sent.length).toBe(before + 1);
    expect(mail.sent.at(-1)!.text).toContain(`${APP}/redefinir-senha?token=`);
    expect(mail.sent.at(-1)!.text).not.toContain("site-falso");
  });

  it("sem envio de e-mail ligado, responde igual e não quebra", async () => {
    const off = createAuth({ db: auth$, secret: "z".repeat(40), baseURL: BASE, rateLimit: false, mailer: () => null });
    const res = await call("/request-password-reset", { email }, off);
    expect(res.status).toBe(200);
  });

  it("limita os pedidos por IP", async () => {
    const limited = createAuth({ db: auth$, secret: "w".repeat(40), baseURL: BASE, rateLimit: true, mailer: () => memoryMailer() });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await call("/request-password-reset", { email }, limited, { "x-forwarded-for": "198.51.100.30" })).status);
    expect(statuses.slice(0, 3).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(3)).toContain(429);
  });
});

describe("criar a senha nova", () => {
  it("troca a senha, derruba as sessões e fica na auditoria", async () => {
    const login = await call("/sign-in/email", { email, password: "senha-antiga-1" });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).not.toBeNull();

    const { token } = await requestToken();
    const short = await call("/reset-password", { newPassword: "curta", token });
    expect(short.status).toBe(400);
    expect((await short.json()).code).toBe("PASSWORD_TOO_SHORT");

    // A senha curta não gasta o link.
    const ok = await call("/reset-password", { newPassword: "senha-nova-123", token });
    expect(ok.status).toBe(200);

    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
    expect((await call("/sign-in/email", { email, password: "senha-antiga-1" })).status).toBe(401);
    expect((await call("/sign-in/email", { email, password: "senha-nova-123" })).status).toBe(200);

    const log = await owner.auditLog.findFirst({ where: { actorUserId: userId, action: "PASSWORD_RESET" } });
    expect(log).toMatchObject({ entity: "user", entityId: userId, ip: "203.0.113.20", userAgent: "vitest" });
  });

  it("o link vale uma vez só", async () => {
    const { token } = await requestToken();
    expect((await call("/reset-password", { newPassword: "outra-senha-1", token })).status).toBe(200);
    const again = await call("/reset-password", { newPassword: "outra-senha-2", token });
    expect(again.status).toBe(400);
    expect((await call("/sign-in/email", { email, password: "outra-senha-1" })).status).toBe(200);
  });

  it("o link expira em 1 hora", async () => {
    const { token } = await requestToken();
    const row = await owner.verification.findFirstOrThrow({ where: { identifier: `reset-password:${token}` } });
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(59 * 60_000);
    expect(row.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(60 * 60_000);
    await owner.verification.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await call("/reset-password", { newPassword: "mais-uma-senha", token })).status).toBe(400);
  });

  it("token inventado não troca nada", async () => {
    expect((await call("/reset-password", { newPassword: "senha-qualquer-1", token: "a".repeat(24) })).status).toBe(400);
  });
});
