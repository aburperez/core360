import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, authDb, expectPgError, expectStatus, ownerDb } from "../helpers";
import { loadActor } from "@/server/authz/actor";
import { withUser } from "@/server/db/with-user";
import { acceptInvitation } from "@/server/auth/invitations";
import { createEvent } from "@/modules/events/events.service";
import { createClient } from "@/modules/clients/clients.service";
import { createDirector, createDirectorInvitation, listDirectors, updateDirector } from "@/modules/directors/directors.service";
import { addAgencyAdmin, createAgency, getAgency, updateAgencyAdmin } from "@/modules/agencies/agencies.service";

/**
 * Diretor de produção = painel administrativo da agência (Abu, 2026-10-08).
 * Cada diretor tem o acesso de Admin ligado pelo banco: cadastrar um cria o
 * outro, e nome, ativo e conta ficam iguais. Só um diretor mexe em diretores;
 * o Suporte só vê.
 */

const app = appDb();
const auth$ = authDb();
const owner = ownerDb();
const uniq = () => Math.random().toString(36).slice(2, 8);
const actorOf = async (userId: string) => (await loadActor(app, userId))!;
const as = <T>(userId: string, fn: Parameters<typeof withUser<T>>[2]) => withUser(app, userId, fn);

let gama: { id: string; directorUserId: string; supportUserId: string };

beforeAll(async () => {
  const platform = await actorFor(app, "admin");
  const g = await createAgency(platform, { name: `Agência Gama ${uniq()}`, adminName: "Gil Gama", adminEmail: `gil-${uniq()}@gama.dev` });
  const r = await acceptInvitation(auth$, { token: g.invite.token, password: "senha-gama-1" });
  const dir = await actorOf(r.userId);
  const sup = await addAgencyAdmin(dir, g.id, { name: "Suporte Gama", email: `sup-${uniq()}@core360.dev`, role: "SUPORTE" });
  const supUser = await owner.user.create({ data: { email: sup.email, name: sup.name, emailVerified: true } });
  await owner.agencyAdmin.update({ where: { id: sup.id }, data: { userId: supUser.id } });
  gama = { id: g.id, directorUserId: r.userId, supportUserId: supUser.id };
});

afterAll(async () => {
  const parts = await owner.participant.findMany({ where: { director: { agencyId: gama.id } }, select: { id: true } });
  await owner.invitation.deleteMany({ where: { participantId: { in: parts.map((p) => p.id) } } });
  await owner.participant.deleteMany({ where: { id: { in: parts.map((p) => p.id) } } });
  await owner.agencyAdmin.updateMany({ where: { agencyId: gama.id }, data: { directorId: null } });
  await owner.director.deleteMany({ where: { agencyId: gama.id } });
  await Promise.all([app.$disconnect(), auth$.$disconnect(), owner.$disconnect()]);
});

describe("diretor de produção é o Admin da agência", () => {
  it("a agência nasce com o primeiro diretor, que abre clientes e eventos e é Gerente neles", async () => {
    const dir = await actorOf(gama.directorUserId);
    expect(dir.adminAgencies).toEqual([expect.objectContaining({ id: gama.id, role: "ADMIN" })]);
    const list = await listDirectors(dir, gama.id);
    expect(list).toEqual([expect.objectContaining({ name: "Gil Gama", linked: true, me: true })]);

    const client = await createClient(dir, { name: "Cliente Gama" });
    const ev = await createEvent(dir, { clientId: client.id, name: "Show Gama", startsAt: "2027-09-01T10:00", endsAt: "2027-09-02T22:00" });
    const p = await owner.participant.findFirst({ where: { eventId: ev.id, userId: gama.directorUserId }, select: { role: true, directorId: true } });
    expect(p).toMatchObject({ role: "GERENTE", directorId: list[0].id });
  });

  it("diretor novo recebe um convite só, mesmo sem evento, e entra como Admin e Gerente", async () => {
    const dir = await actorOf(gama.directorUserId);
    const nova = await createDirector(dir, { agencyId: gama.id, name: "Nina Gama", email: `nina-${uniq()}@gama.dev` });
    const admin = await owner.agencyAdmin.findUnique({ where: { directorId: nova.id } });
    expect(admin).toMatchObject({ role: "ADMIN", active: true, name: "Nina Gama", userId: null });
    expect(nova.events.length).toBe(1);

    const inv = await createDirectorInvitation(dir, nova.id);
    expect(inv.path).toMatch(/^\/convite\//);
    expect((await listDirectors(dir, gama.id)).find((x) => x.id === nova.id)?.invited).toBe(true);
    const r = await acceptInvitation(auth$, { token: inv.token, password: "senha-nina-1" });

    const nina = await actorOf(r.userId);
    expect(nina.adminAgencies.map((a) => [a.id, a.role])).toEqual([[gama.id, "ADMIN"]]);
    const parts = await owner.participant.findMany({ where: { directorId: nova.id }, select: { userId: true } });
    expect(parts.every((x) => x.userId === r.userId)).toBe(true);
    // E ela já cadastra outro diretor.
    const x = await createDirector(nina, { agencyId: gama.id, name: "Xavier", email: `xa-${uniq()}@gama.dev` });
    expect(x.active).toBe(true);
  });

  it("outro Admin cadastrado pela plataforma vira diretor", async () => {
    const platform = await actorFor(app, "admin");
    const a = await addAgencyAdmin(platform, gama.id, { name: "Paula Gama", email: `paula-${uniq()}@gama.dev` });
    const row = await owner.agencyAdmin.findUnique({ where: { id: a.id }, select: { directorId: true } });
    const dirRow = await owner.director.findUnique({ where: { id: row!.directorId! } });
    expect(dirRow).toMatchObject({ agencyId: gama.id, name: "Paula Gama", email: a.email, active: true });
  });

  it("nome e ativo mudam nos dois lados; desativar tira o painel e os eventos", async () => {
    const dir = await actorOf(gama.directorUserId);
    const t = await createDirector(dir, { agencyId: gama.id, name: "Téo", email: `teo-${uniq()}@gama.dev` });
    const { token } = await createDirectorInvitation(dir, t.id);
    const r = await acceptInvitation(auth$, { token, password: "senha-teo-1" });

    await updateDirector(dir, t.id, { name: "Teodoro" });
    expect((await owner.agencyAdmin.findUnique({ where: { directorId: t.id } }))?.name).toBe("Teodoro");

    await updateDirector(dir, t.id, { active: false });
    expect((await owner.agencyAdmin.findUnique({ where: { directorId: t.id } }))?.active).toBe(false);
    const teo = await actorOf(r.userId);
    expect(teo.adminAgencies).toEqual([]);
    expect(teo.memberships).toEqual([]);

    // Pelo lado do Admin também.
    const adminId = (await owner.agencyAdmin.findUnique({ where: { directorId: t.id } }))!.id;
    await updateAgencyAdmin(dir, adminId, { active: true });
    expect((await owner.director.findUnique({ where: { id: t.id } }))?.active).toBe(true);
    expect((await actorOf(r.userId)).adminAgencies.map((a) => a.id)).toEqual([gama.id]);
  });

  it("ninguém se desativa, nem pelo diretor nem pelo banco", async () => {
    const dir = await actorOf(gama.directorUserId);
    const me = (await listDirectors(dir, gama.id)).find((x) => x.me)!;
    await expectStatus(updateDirector(dir, me.id, { active: false }), 422);
    await expectPgError(as(gama.directorUserId, (tx) => tx.director.update({ where: { id: me.id }, data: { active: false } })), "42501");
    expect((await owner.director.findUnique({ where: { id: me.id } }))?.active).toBe(true);
  });

  it("o Suporte vê os diretores, mas não cadastra, convida nem desativa", async () => {
    const sup = await actorOf(gama.supportUserId);
    const list = await listDirectors(sup, gama.id);
    expect(list.length).toBeGreaterThan(0);
    await expectStatus(createDirector(sup, { agencyId: gama.id, name: "Intruso", email: `in-${uniq()}@gama.dev` }), 403);
    await expectStatus(updateDirector(sup, list[0].id, { active: false }), 403);
    const pending = await createDirector(await actorOf(gama.directorUserId), { agencyId: gama.id, name: "Rui", email: `rui-${uniq()}@gama.dev` });
    await expectStatus(createDirectorInvitation(sup, pending.id), 403);
    // Pelo banco: nem insere nem muda diretor.
    await expectPgError(
      as(gama.supportUserId, (tx) => tx.director.create({ data: { agencyId: gama.id, name: "X", email: `x-${uniq()}@gama.dev`, createdById: gama.supportUserId } })),
      "42501",
    );
    expect(await as(gama.supportUserId, (tx) => tx.director.updateMany({ where: { agencyId: gama.id }, data: { active: false } }))).toEqual({ count: 0 });
  });

  it("o vínculo diretor-Admin é só do banco", async () => {
    const dir = await actorOf(gama.directorUserId);
    const other = (await getAgency(dir, gama.id)).admins.find((a) => a.role === "ADMIN" && a.name !== "Gil Gama")!;
    await expectPgError(
      as(gama.directorUserId, (tx) => tx.agencyAdmin.update({ where: { id: other.id }, data: { directorId: null } })),
      "42501",
    );
    // Quem já é Suporte não vira diretor com o mesmo e-mail.
    const sup = (await getAgency(dir, gama.id)).admins.find((a) => a.role === "SUPORTE")!;
    await expectStatus(createDirector(dir, { agencyId: gama.id, name: "Dupla", email: sup.email }), 409);
  });
});
