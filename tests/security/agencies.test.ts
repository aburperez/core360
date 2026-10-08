import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, authDb, demo, expectPgError, expectStatus, ownerDb } from "../helpers";
import { loadActor } from "@/server/authz/actor";
import { canSeeEvent } from "@/server/authz/policy";
import { withUser } from "@/server/db/with-user";
import { acceptInvitation, previewInvitation } from "@/server/auth/invitations";
import { createEvent, getEvent, listEvents, updateEvent } from "@/modules/events/events.service";
import { createClient, listClients, updateClient } from "@/modules/clients/clients.service";
import { createDirector, listDirectors } from "@/modules/directors/directors.service";
import {
  addAgencyAdmin,
  createAgency,
  createAgencyAdminInvitation,
  getAgency,
  listAgencies,
  updateAgency,
  updateAgencyAdmin,
} from "@/modules/agencies/agencies.service";

/**
 * Várias agências no mesmo app: cada uma é um espaço fechado. O Admin da
 * agência só enxerga e cria o que é dela; o Admin da plataforma cria e
 * suspende agências, mas não abre os eventos delas. Agência suspensa: ninguém
 * dela entra até reativar.
 */

const app = appDb();
const auth$ = authDb();
const owner = ownerDb();
const d = demo();
const uniq = () => Math.random().toString(36).slice(2, 8);

// Agência Beta, criada pelo Admin da plataforma (o admin da demonstração também é Admin da plataforma).
let beta: { id: string; adminUserId: string; clientId: string; eventId: string; gerenteUserId: string };

const actorOf = async (userId: string) => (await loadActor(app, userId))!;
const as = <T>(userId: string, fn: Parameters<typeof withUser<T>>[2]) => withUser(app, userId, fn);

beforeAll(async () => {
  const platform = await actorFor(app, "admin");
  const email = `beta-${uniq()}@beta.dev`;
  const g = await createAgency(platform, { name: `Agência Beta ${uniq()}`, adminName: "Bia Beta", adminEmail: email });
  const r = await acceptInvitation(auth$, { token: g.invite.token, password: "senha-beta-1" });
  const betaAdmin = await actorOf(r.userId);
  const client = await createClient(betaAdmin, { name: "Cliente Beta" });
  const event = await createEvent(betaAdmin, {
    clientId: client.id, name: "Feira Beta", startsAt: "2027-08-01T09:00", endsAt: "2027-08-03T18:00",
  });
  // Um Gerente da Beta com conta (para testar a suspensão).
  const gerente = await owner.user.create({ data: { email: `ger-${uniq()}@beta.dev`, name: "Gil Gerente", emailVerified: true } });
  await owner.participant.create({
    data: { eventId: event.id, userId: gerente.id, name: gerente.name, email: gerente.email, role: "GERENTE", joinedAt: new Date() },
  });
  beta = { id: g.id, adminUserId: r.userId, clientId: client.id, eventId: event.id, gerenteUserId: gerente.id };
});

afterAll(async () => {
  await owner.agency.update({ where: { id: beta.id }, data: { status: "ACTIVE" } });
  const parts = await owner.participant.findMany({ where: { director: { agencyId: beta.id } }, select: { id: true } });
  await owner.participant.deleteMany({ where: { id: { in: parts.map((p) => p.id) } } });
  await owner.agencyAdmin.updateMany({ where: { agencyId: beta.id }, data: { directorId: null } });
  await owner.director.deleteMany({ where: { agencyId: beta.id } });
  await Promise.all([app.$disconnect(), auth$.$disconnect(), owner.$disconnect()]);
});

describe("agências separadas", () => {
  it("o convite de Admin liga a conta e a agência; o evento fica no fuso do evento", async () => {
    const a = await actorOf(beta.adminUserId);
    expect(a.adminAgencies.map((x) => x.id)).toEqual([beta.id]);
    expect(a.isPlatformAdmin).toBe(false);
    expect(a.adminEventIds.has(beta.eventId)).toBe(true);
    const e = await owner.event.findUniqueOrThrow({ where: { id: beta.eventId } });
    expect(e.agencyId).toBe(beta.id);
    // "09:00" digitado na tela = 09:00 em São Paulo = 12:00 UTC.
    expect(e.startsAt.toISOString()).toBe("2027-08-01T12:00:00.000Z");
  });

  it("o Admin de uma agência não vê nada da outra", async () => {
    const betaAdmin = await actorOf(beta.adminUserId);
    const demoAdmin = await actorFor(app, "admin");

    // Eventos
    const betaEvents = (await listEvents(betaAdmin)).map((e) => e.id);
    expect(betaEvents).toEqual([beta.eventId]);
    expect(canSeeEvent(betaAdmin, d.events.rock.id)).toBe(false);
    await expectStatus(getEvent(betaAdmin, d.events.rock.id), 404);
    const demoEvents = (await listEvents(demoAdmin)).map((e) => e.id);
    expect(demoEvents).toEqual(expect.arrayContaining([d.events.rock.id, d.events.congresso.id]));
    expect(demoEvents).not.toContain(beta.eventId);
    await expectStatus(getEvent(demoAdmin, beta.eventId), 404);

    // Clientes
    expect((await listClients(betaAdmin)).map((c) => c.id)).toEqual([beta.clientId]);
    expect((await listClients(demoAdmin)).map((c) => c.id)).not.toContain(beta.clientId);
    await expectStatus(updateClient(betaAdmin, d.clients.rock.id, { name: "Roubado" }), 404);
    await expectStatus(listClients(betaAdmin, d.agency.id), 404);

    // Direto no banco também não.
    for (const [user, other] of [[beta.adminUserId, d.events.rock.id], [d.users.admin!, beta.eventId]] as const) {
      expect(await as(user, (tx) => tx.event.findMany({ where: { id: other } }))).toEqual([]);
      expect(await as(user, (tx) => tx.area.findMany({ where: { eventId: other } }))).toEqual([]);
      expect(await as(user, (tx) => tx.participant.findMany({ where: { eventId: other } }))).toEqual([]);
      expect(await as(user, (tx) => tx.occurrence.findMany({ where: { eventId: other } }))).toEqual([]);
    }
    const seenClients = await as(beta.adminUserId, (tx) => tx.client.findMany({ select: { id: true } }));
    expect(seenClients.map((c) => c.id)).toEqual([beta.clientId]);
    // Pessoas: o Admin da Beta não enxerga a equipe da demonstração.
    const seenUsers = await as(beta.adminUserId, (tx) => tx.user.findMany({ select: { id: true } }));
    expect(seenUsers.map((u) => u.id)).not.toContain(d.users.marina);
    expect(seenUsers.map((u) => u.id)).toContain(beta.gerenteUserId);
  });

  it("não cria evento para cliente de outra agência, nem pelo banco", async () => {
    const betaAdmin = await actorOf(beta.adminUserId);
    await expectStatus(
      createEvent(betaAdmin, { clientId: d.clients.rock.id, name: "Intruso", startsAt: "2027-01-01T10:00", endsAt: "2027-01-01T12:00" }),
      404,
    );
    await expectPgError(
      as(beta.adminUserId, (tx) =>
        tx.event.create({
          data: { agencyId: d.agency.id, clientId: d.clients.rock.id, name: "Intruso", startsAt: new Date(), endsAt: new Date() },
        }),
      ),
      "42501",
    );
    // Evento da Beta com cliente da demonstração: a chave composta recusa.
    await expectPgError(
      owner.event.create({ data: { agencyId: beta.id, clientId: d.clients.rock.id, name: "Misturado", startsAt: new Date(), endsAt: new Date() } }),
      "23503",
    );
    // Nada muda de agência depois de criado.
    await expectPgError(owner.event.update({ where: { id: beta.eventId }, data: { agencyId: d.agency.id } }), "23514");
  });

  it("diretor da agência só entra nos eventos dela", async () => {
    const betaAdmin = await actorOf(beta.adminUserId);
    const dir = await createDirector(betaAdmin, { name: "Dora Beta", email: `dora-${uniq()}@beta.dev` });
    expect(dir.events.map((e) => e.id)).toEqual([beta.eventId]);
    const parts = await owner.participant.findMany({ where: { directorId: dir.id }, select: { eventId: true } });
    expect(parts.map((p) => p.eventId)).toEqual([beta.eventId]);
    expect((await listDirectors(await actorFor(app, "admin"))).map((x) => x.id)).not.toContain(dir.id);
    // O mesmo e-mail pode ser diretor em duas agências.
    await createDirector(await actorFor(app, "admin"), { name: "Dora", email: dir.email }).then(async (x) => {
      const p = await owner.participant.findMany({ where: { directorId: x.id }, select: { eventId: true } });
      expect(p.map((r) => r.eventId)).not.toContain(beta.eventId);
      await owner.participant.deleteMany({ where: { directorId: x.id } });
      await owner.agencyAdmin.deleteMany({ where: { directorId: x.id } });
      await owner.director.delete({ where: { id: x.id } });
    });
  });

  it("só o Admin da plataforma cria, renomeia e suspende agências", async () => {
    const betaAdmin = await actorOf(beta.adminUserId);
    await expectStatus(listAgencies(betaAdmin), 404);
    await expectStatus(createAgency(betaAdmin, { name: "Nova", adminName: "X", adminEmail: "x@x.dev" }), 404);
    await expectStatus(updateAgency(betaAdmin, beta.id, { status: "SUSPENDED" }), 404);
    await expectStatus(getAgency(betaAdmin, d.agency.id), 404);
    // O primeiro diretor e a Dora (todo diretor de produção tem o acesso de Admin).
    expect((await getAgency(betaAdmin, beta.id)).admins.map((a) => a.role)).toEqual(["ADMIN", "ADMIN"]);
    // Pelo banco: não enxerga outra agência e não muda a própria.
    expect(await as(beta.adminUserId, (tx) => tx.agency.findMany({ where: { id: d.agency.id } }))).toEqual([]);
    expect(await as(beta.adminUserId, (tx) => tx.agency.updateMany({ where: { id: beta.id }, data: { status: "SUSPENDED" } }))).toEqual({ count: 0 });
    // Gerente, Head, Operacional: nada de agência.
    const marina = await actorFor(app, "marina");
    await expectStatus(listAgencies(marina), 404);
    await expectStatus(listClients(marina), 404);
    expect(await as(d.users.marina!, (tx) => tx.agency.findMany())).toEqual([]);
    expect(await as(d.users.marina!, (tx) => tx.agencyAdmin.findMany())).toEqual([]);
    // O Admin da plataforma vê todas.
    const all = (await listAgencies(await actorFor(app, "admin"))).map((a) => a.id);
    expect(all).toEqual(expect.arrayContaining([beta.id, d.agency.id]));
  });

  it("o Admin cadastra outro Admin da agência, mas não liga conta nem se desativa", async () => {
    const betaAdmin = await actorOf(beta.adminUserId);
    const other = await addAgencyAdmin(betaAdmin, beta.id, { name: "Beto", email: `beto-${uniq()}@beta.dev` });
    await expectStatus(addAgencyAdmin(betaAdmin, beta.id, { name: "Beto 2", email: other.email.toUpperCase() }), 409);
    await expectStatus(addAgencyAdmin(betaAdmin, d.agency.id, { name: "Intruso", email: "i@x.dev" }), 404);
    const inv = await createAgencyAdminInvitation(betaAdmin, other.id);
    expect((await previewInvitation(auth$, inv.token)).agency).toMatch(/^Agência Beta/);

    const me = await owner.agencyAdmin.findFirstOrThrow({ where: { agencyId: beta.id, userId: beta.adminUserId } });
    await expectStatus(updateAgencyAdmin(betaAdmin, me.id, { active: false }), 422);
    await expectPgError(as(beta.adminUserId, (tx) => tx.$executeRaw`UPDATE agency_admins SET active = false WHERE id = ${me.id}::uuid`), "42501");
    await expectPgError(
      as(beta.adminUserId, (tx) => tx.$executeRaw`UPDATE agency_admins SET user_id = ${d.users.marina}::uuid WHERE id = ${other.id}::uuid`),
      "42501",
    );
    await expectPgError(
      as(beta.adminUserId, (tx) => tx.$executeRaw`INSERT INTO agency_admins (id, agency_id, name, email, user_id, updated_at)
        VALUES (gen_random_uuid(), ${beta.id}::uuid, 'Z', ${`z-${uniq()}@x.dev`}, ${d.users.marina}::uuid, now())`),
      "42501",
    );
  });

  it("agência suspensa: ninguém dela entra; reativada, tudo volta", async () => {
    const platform = await actorFor(app, "admin");
    await updateAgency(platform, beta.id, { status: "SUSPENDED" });

    const a = await actorOf(beta.adminUserId);
    expect(a.adminAgencies).toEqual([]);
    expect(a.suspendedAgencies.map((x) => x.id)).toEqual([beta.id]);
    expect(await listEvents(a)).toEqual([]);
    const g = await actorOf(beta.gerenteUserId);
    expect(g.memberships).toEqual([]);
    expect(await as(beta.gerenteUserId, (tx) => tx.event.findMany({ where: { id: beta.eventId } }))).toEqual([]);
    await expectStatus(getEvent(g, beta.eventId), 404);
    // A demonstração segue normal.
    expect((await actorFor(app, "marina")).memberships.length).toBeGreaterThan(0);

    await updateAgency(platform, beta.id, { status: "ACTIVE" });
    expect((await actorOf(beta.gerenteUserId)).memberships.map((m) => m.eventId)).toEqual([beta.eventId]);
    expect((await actorOf(beta.adminUserId)).adminAgencies.map((x) => x.id)).toEqual([beta.id]);
  });

  it("Admin ou Gerente mudam os dados do evento; os outros não", async () => {
    const betaAdmin = await actorOf(beta.adminUserId);
    await updateEvent(betaAdmin, beta.eventId, { venue: "Pavilhão 2", status: "MONTAGEM", endsAt: "2027-08-03T20:00" });
    const e = await owner.event.findUniqueOrThrow({ where: { id: beta.eventId } });
    expect(e).toMatchObject({ venue: "Pavilhão 2", status: "MONTAGEM", name: "Feira Beta" });
    expect(e.endsAt.toISOString()).toBe("2027-08-03T23:00:00.000Z");
    await expectStatus(updateEvent(betaAdmin, beta.eventId, { endsAt: "2027-07-01T10:00" }), 422);
    await updateEvent(await actorOf(beta.gerenteUserId), beta.eventId, { name: "Feira Beta 2027" });
    expect((await owner.event.findUniqueOrThrow({ where: { id: beta.eventId } })).name).toBe("Feira Beta 2027");
    await expectStatus(updateEvent(await actorFor(app, "rafael"), d.events.rock.id, { name: "X" }), 403);
    await expectStatus(updateEvent(await actorFor(app, "marina"), beta.eventId, { name: "X" }), 404);
  });

  it("Suporte: só a agência autoriza; ele ajuda nos eventos dela, mas não mexe em Admins", async () => {
    const platform = await actorFor(app, "admin");
    const betaAdmin = await actorOf(beta.adminUserId);
    const email = `suporte-${uniq()}@core360.dev`;

    // A plataforma não se autoriza sozinha, nem pelo banco.
    await expectStatus(addAgencyAdmin(platform, beta.id, { name: "Sup", email, role: "SUPORTE" }), 403);
    await expectPgError(
      as(d.users.admin!, (tx) =>
        tx.$executeRaw`INSERT INTO agency_admins (id, agency_id, name, email, role, updated_at)
                       VALUES (gen_random_uuid(), ${beta.id}::uuid, 'Sup', ${email}, 'SUPORTE', now())`),
      "42501",
    );

    // O Admin da Beta autoriza e manda o convite.
    const sup = await addAgencyAdmin(betaAdmin, beta.id, { name: "Sueli Suporte", email, role: "SUPORTE" });
    expect(sup.role).toBe("SUPORTE");
    const inv = await createAgencyAdminInvitation(betaAdmin, sup.id);
    expect((await previewInvitation(auth$, inv.token)).agencyRole).toBe("SUPORTE");
    const r = await acceptInvitation(auth$, { token: inv.token, password: "senha-sup-1" });
    const support = await actorOf(r.userId);
    expect(support.adminAgencies).toEqual([expect.objectContaining({ id: beta.id, role: "SUPORTE" })]);
    expect(support.supportEventIds.has(beta.eventId)).toBe(true);
    expect(betaAdmin.supportEventIds.size).toBe(0);

    // Ajuda nos eventos da Beta, e só nela.
    expect((await listEvents(support)).map((e) => e.id)).toEqual([beta.eventId]);
    await updateEvent(support, beta.eventId, { venue: "Pavilhão 2" });
    await expectStatus(getEvent(support, d.events.rock.id), 404);
    expect((await listClients(support)).map((c) => c.id)).toEqual([beta.clientId]);

    // Não cadastra, convida nem desliga Admins ou Suporte.
    await expectStatus(addAgencyAdmin(support, beta.id, { name: "Outro", email: `x-${uniq()}@x.dev` }), 403);
    const bia = (await getAgency(betaAdmin, beta.id)).admins.find((a) => a.role === "ADMIN")!;
    await expectStatus(updateAgencyAdmin(support, bia.id, { active: false }), 403);
    await expectPgError(
      as(r.userId, (tx) =>
        tx.$executeRaw`INSERT INTO agency_admins (id, agency_id, name, email, updated_at)
                       VALUES (gen_random_uuid(), ${beta.id}::uuid, 'Intruso', ${`i-${uniq()}@x.dev`}, now())`),
      "42501",
    );
    expect(await as(r.userId, (tx) => tx.$executeRaw`UPDATE agency_admins SET active = false WHERE id = ${bia.id}::uuid`)).toBe(0);
    await expectPgError(
      as(r.userId, (tx) =>
        tx.agencyInvitation.create({
          data: { agencyId: beta.id, agencyAdminId: bia.id, tokenHash: `h-${uniq()}`, expiresAt: new Date(Date.now() + 1e6), createdById: r.userId },
        })),
      "42501",
    );

    // Nem a plataforma desliga o Suporte; quem desliga é a agência. O papel não muda.
    await expectStatus(updateAgencyAdmin(platform, sup.id, { active: false }), 403);
    await expectPgError(owner.agencyAdmin.update({ where: { id: sup.id }, data: { role: "ADMIN" } }), "23514");
    expect((await listAgencies(platform)).find((a) => a.id === beta.id)!.admins.some((a) => a.role === "SUPORTE" && a.active)).toBe(true);

    await updateAgencyAdmin(betaAdmin, sup.id, { active: false });
    const off = await actorOf(r.userId);
    expect(off.adminAgencies).toEqual([]);
    expect(await listEvents(off)).toEqual([]);
    await expectStatus(getEvent(off, beta.eventId), 404);
    expect(await as(r.userId, (tx) => tx.event.findMany({ where: { id: beta.eventId } }))).toEqual([]);
  });
});
