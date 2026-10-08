import { afterAll, describe, expect, it } from "vitest";
import { actorFor, appDb, authDb, demo, expectPgError, expectStatus, ownerDb, type Person } from "../helpers";
import { withUser } from "@/server/db/with-user";
import { acceptInvitation } from "@/server/auth/invitations";
import { createEvent } from "@/modules/events/events.service";
import { updateParticipant } from "@/modules/participants/participants.service";
import {
  createDirector,
  createDirectorInvitation,
  listDirectors,
  updateDirector,
} from "@/modules/directors/directors.service";

/**
 * Diretores de produção: o Admin cadastra uma vez e o banco põe a pessoa como
 * Gerente em todos os eventos abertos, inclusive os que forem criados depois.
 * Um convite só liga a conta em todos. Ninguém além do Admin vê esta parte.
 */

const app = appDb();
const auth$ = authDb();
const owner = ownerDb();
const d = demo();
const rock = d.events.rock.id;
const congresso = d.events.congresso.id;
const uniq = () => Math.random().toString(36).slice(2, 8);
const createdEvents: string[] = [];

afterAll(async () => {
  // Os diretores entram em todos os eventos abertos; tira tudo para não mexer nos outros testes
  // (só os da agência de demonstração: outros arquivos têm agências próprias).
  const mine = { agencyId: d.agency.id };
  const parts = await owner.participant.findMany({ where: { director: mine }, select: { id: true } });
  const ids = parts.map((p) => p.id);
  await owner.invitation.deleteMany({ where: { participantId: { in: ids } } });
  await owner.participant.deleteMany({ where: { id: { in: ids } } });
  await owner.director.deleteMany({ where: mine });
  await owner.event.updateMany({ where: { id: { in: createdEvents } }, data: { deletedAt: new Date() } });
  await Promise.all([app.$disconnect(), auth$.$disconnect(), owner.$disconnect()]);
});

const directorParts = (directorId: string) =>
  owner.participant.findMany({
    where: { directorId },
    select: { eventId: true, role: true, active: true, userId: true, name: true, areaId: true, teamId: true },
  });

async function newEvent(status?: "CONCLUIDO" | "CANCELADO") {
  const admin = await actorFor(app, "admin");
  const e = await createEvent(admin, {
    clientId: d.clients.rock.id, name: `Evento ${uniq()}`, startsAt: "2027-05-01T10:00:00Z", endsAt: "2027-05-02T22:00:00Z",
  });
  createdEvents.push(e.id);
  if (status) await owner.event.update({ where: { id: e.id }, data: { status } });
  return e.id;
}

describe("diretor em todos os eventos", () => {
  it("o Admin cadastra uma vez e ele vira Gerente só nos eventos abertos", async () => {
    const closed = await newEvent("CONCLUIDO");
    const cancelled = await newEvent("CANCELADO");
    const admin = await actorFor(app, "admin");
    const dir = await createDirector(admin, { name: "Helena Diretora", email: `Helena-${uniq()}@agencia.dev`, jobTitle: "Diretora de produção" });

    expect(dir.email).toBe(dir.email.toLowerCase());
    expect(dir).toMatchObject({ active: true, linked: false, invited: false });
    expect(dir.events.map((e) => e.id)).toEqual(expect.arrayContaining([rock, congresso]));

    const parts = await directorParts(dir.id);
    expect(parts.every((p) => p.role === "GERENTE" && p.active && !p.userId && !p.areaId && !p.teamId)).toBe(true);
    const events = parts.map((p) => p.eventId);
    expect(events).toEqual(expect.arrayContaining([rock, congresso]));
    expect(events).not.toContain(closed);
    expect(events).not.toContain(cancelled);

    // Evento novo: o diretor entra sozinho.
    const fresh = await newEvent();
    expect((await directorParts(dir.id)).map((p) => p.eventId)).toContain(fresh);
    expect(await owner.auditLog.count({ where: { entity: "participant", eventId: fresh, action: "CREATE" } })).toBeGreaterThan(0);
  });

  it("quem já está no evento com o mesmo e-mail continua com o papel que tinha", async () => {
    const admin = await actorFor(app, "admin");
    const dir = await createDirector(admin, { name: "Carlos", email: "carlos@rockfestival.dev" });
    const carlos = await owner.participant.findUniqueOrThrow({ where: { id: d.participants.carlos.id } });
    expect(carlos).toMatchObject({ role: "OPERACIONAL", directorId: null });
    const events = (await directorParts(dir.id)).map((p) => p.eventId);
    expect(events).not.toContain(rock);
    expect(events).toContain(congresso);
  });

  it("e-mail repetido é recusado", async () => {
    const admin = await actorFor(app, "admin");
    const email = `dup-${uniq()}@agencia.dev`;
    await createDirector(admin, { name: "Um", email });
    await expectStatus(createDirector(admin, { name: "Dois", email: email.toUpperCase() }), 409);
    await expectStatus(createDirector(admin, { name: "Sem e-mail", email: "isso-nao" }), 422);
  });

  it("só o Admin vê e mexe; para os outros a página não existe", async () => {
    const admin = await actorFor(app, "admin");
    const dir = await createDirector(admin, { name: "Íris", email: `iris-${uniq()}@agencia.dev` });
    for (const p of ["marina", "paulo", "rafael", "joao", "sofia", "claudia"] as Person[]) {
      const a = await actorFor(app, p);
      await expectStatus(listDirectors(a), 404);
      await expectStatus(createDirector(a, { name: "X", email: `x-${uniq()}@x.dev` }), 404);
      await expectStatus(updateDirector(a, dir.id, { active: false }), 404);
      await expectStatus(createDirectorInvitation(a, dir.id), 404);
      // Direto no banco também não.
      const rows = await withUser(app, d.users[p]!, (tx) => tx.director.findMany());
      expect(rows).toEqual([]);
      await expectPgError(
        withUser(app, d.users[p]!, (tx) => tx.$executeRaw`INSERT INTO directors (id, name, email, created_by) VALUES (gen_random_uuid(), 'X', 'x@x.dev', ${d.users[p]}::uuid)`),
        "42501",
      );
    }
  });

  it("a aplicação não liga conta nem cria participação de diretor por conta própria", async () => {
    const admin = await actorFor(app, "admin");
    const dir = await createDirector(admin, { name: "Joana", email: `joana-${uniq()}@agencia.dev` });
    const as = <T>(fn: Parameters<typeof withUser<T>>[2]) => withUser(app, d.users.admin!, fn);

    // Nem o Admin, pela aplicação, liga uma conta ao diretor ou troca quem criou.
    await expectPgError(as((tx) => tx.$executeRaw`UPDATE directors SET user_id = ${d.users.joao}::uuid WHERE id = ${dir.id}::uuid`), "42501");
    await expectPgError(as((tx) => tx.$executeRaw`UPDATE directors SET created_by = ${d.users.marina}::uuid WHERE id = ${dir.id}::uuid`), "42501");
    await expectPgError(
      as((tx) => tx.$executeRaw`INSERT INTO directors (id, name, email, created_by, user_id) VALUES (gen_random_uuid(), 'Y', ${`y-${uniq()}@x.dev`}, ${d.users.admin}::uuid, ${d.users.joao}::uuid)`),
      "42501",
    );
    // O e-mail não muda depois do cadastro.
    await expectPgError(as((tx) => tx.$executeRaw`UPDATE directors SET email = 'outro@x.dev' WHERE id = ${dir.id}::uuid`), "23514");
    // Participação de diretor só o banco cria ou muda.
    const part = (await owner.participant.findFirstOrThrow({ where: { directorId: dir.id, eventId: rock } })).id;
    await expectPgError(as((tx) => tx.$executeRaw`UPDATE participants SET director_id = NULL WHERE id = ${part}::uuid`), "42501");
    await expectPgError(
      as((tx) => tx.$executeRaw`UPDATE participants SET director_id = ${dir.id}::uuid WHERE id = ${d.participants.joao.id}::uuid`),
      "42501",
    );
  });

  it("um convite só liga a conta em todos os eventos, inclusive nos que vierem depois", async () => {
    const admin = await actorFor(app, "admin");
    const email = `bia-${uniq()}@agencia.dev`;
    const dir = await createDirector(admin, { name: "Bia Diretora", email });
    const inv = await createDirectorInvitation(admin, dir.id);
    const r = await acceptInvitation(auth$, { token: inv.token, password: "minha-senha-1" });
    expect(r).toMatchObject({ email, newAccount: true });

    const parts = await directorParts(dir.id);
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts.every((p) => p.userId === r.userId)).toBe(true);
    expect(await owner.director.findUniqueOrThrow({ where: { id: dir.id } })).toMatchObject({ userId: r.userId });

    const fresh = await newEvent();
    const later = await owner.participant.findFirstOrThrow({ where: { directorId: dir.id, eventId: fresh } });
    expect(later).toMatchObject({ userId: r.userId, role: "GERENTE" });
    expect(later.joinedAt).not.toBeNull();

    // Já entrou: não precisa de outro convite.
    await expectStatus(createDirectorInvitation(admin, dir.id), 422);
    const [view] = (await listDirectors(admin)).filter((x) => x.id === dir.id);
    expect(view).toMatchObject({ linked: true });
  });

  it("desativar tira de todos os eventos; reativar devolve", async () => {
    const admin = await actorFor(app, "admin");
    const dir = await createDirector(admin, { name: "Rui", email: `rui-${uniq()}@agencia.dev` });
    const off = await updateDirector(admin, dir.id, { active: false });
    expect(off).toMatchObject({ active: false, events: [] });
    expect((await directorParts(dir.id)).every((p) => !p.active)).toBe(true);
    await expectStatus(createDirectorInvitation(admin, dir.id), 422);

    // Desativado não entra em evento novo.
    const fresh = await newEvent();
    expect((await directorParts(dir.id)).map((p) => p.eventId)).not.toContain(fresh);

    const on = await updateDirector(admin, dir.id, { active: true, phone: "11 99999-0000" });
    expect(on.active).toBe(true);
    const parts = await directorParts(dir.id);
    expect(parts.every((p) => p.active)).toBe(true);
    expect(parts.map((p) => p.eventId)).toContain(fresh);
    expect(await owner.auditLog.count({ where: { entity: "director", entityId: dir.id, action: { in: ["DEACTIVATE", "ACTIVATE"] } } })).toBe(2);
  });

  it("mudar o nome vale para todos os eventos dele", async () => {
    const admin = await actorFor(app, "admin");
    const dir = await createDirector(admin, { name: "Léo", email: `leo-${uniq()}@agencia.dev` });
    await updateDirector(admin, dir.id, { name: "Leonardo Diretor" });
    expect((await directorParts(dir.id)).every((p) => p.name === "Leonardo Diretor")).toBe(true);
  });

  it("o Gerente do evento não consegue mexer na participação do diretor", async () => {
    const admin = await actorFor(app, "admin");
    const dir = await createDirector(admin, { name: "Tânia", email: `tania-${uniq()}@agencia.dev` });
    const part = await owner.participant.findFirstOrThrow({ where: { directorId: dir.id, eventId: rock } });
    const marina = await actorFor(app, "marina");
    await expectStatus(updateParticipant(marina, part.id, { active: false }), 403);
  });
});
