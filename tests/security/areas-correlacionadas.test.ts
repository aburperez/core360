import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectPgError, expectStatus, ownerDb, type Person } from "../helpers";
import { withUser, type Tx } from "@/server/db/with-user";
import { canAssignRole, canGrantSectionsFor, canSeeOccurrence, canSeeTeam, headCovers } from "@/server/authz/policy";
import { HEAD_SECTIONS, SECTIONS } from "@/server/authz/sections";
import { createEvent } from "@/modules/events/events.service";
import { createParticipant, listParticipants, updateParticipant } from "@/modules/participants/participants.service";
import { listProducerAccess, setProducerAccess } from "@/modules/participants/producer-access.service";
import { listHeadAreas, setHeadAreas } from "@/modules/participants/head-areas.service";
import { createOccurrence, listOccurrences } from "@/modules/occurrences/occurrences.service";

/**
 * Hierarquia de acessos, etapa 2 (Abu, 2026-10-21): o diretor dá ao Head
 * áreas correlacionadas, e nelas o Head vê e age como na área dele; o
 * Pré-produtor fica numa área, e o Head que cobre essa área marca as caixas
 * dele, menos as de valores e do cliente. Pelo serviço e no banco.
 */

const db = appDb();
const owner = ownerDb();
const d = demo();
const as = <T>(p: Person, fn: (tx: Tx) => Promise<T>) => withUser(db, d.users[p]!, fn);

let ev: string;
let palco: string;
let ceno: string;
let ab: string;
let marceneiros: string;
let rafaelP: string;
let sofiaP: string;
let occCeno: string;

beforeAll(async () => {
  ev = (await createEvent(await actorFor(db, "admin"), { clientId: d.clients.rock.id, name: "Feira das áreas", startsAt: "2027-12-20T10:00", endsAt: "2027-12-22T22:00" })).id;
  palco = (await owner.area.create({ data: { eventId: ev, name: "Palco" } })).id;
  ceno = (await owner.area.create({ data: { eventId: ev, name: "Cenografia" } })).id;
  ab = (await owner.area.create({ data: { eventId: ev, name: "A&B" } })).id;
  marceneiros = (await owner.team.create({ data: { eventId: ev, areaId: ceno, name: "Marcenaria" } })).id;
  const join = (p: Person, role: "GERENTE" | "PRE_PRODUTOR" | "HEAD", areaId?: string) =>
    owner.participant.create({ data: { eventId: ev, userId: d.users[p]!, name: p, email: `${p}-ac@rockfestival.dev`, role, areaId, joinedAt: new Date() } });
  await join("marina", "GERENTE");
  rafaelP = (await join("rafael", "HEAD", palco)).id;
  sofiaP = (await join("sofia", "PRE_PRODUTOR")).id;
  occCeno = (await createOccurrence(await actorFor(db, "marina"), { teamId: marceneiros, title: "Parede do cenário torta" })).id;
});

afterAll(async () => {
  await owner.event.update({ where: { id: ev }, data: { deletedAt: new Date() } });
  await Promise.all([db.$disconnect(), owner.$disconnect()]);
});

describe("pré-produtor numa área", () => {
  it("o Gerente liga o pré-produtor a uma área; equipe não", async () => {
    const m = await actorFor(db, "marina");
    expect((await updateParticipant(m, sofiaP, { areaId: ceno })).areaId).toBe(ceno);
    await expectStatus(updateParticipant(m, sofiaP, { teamId: marceneiros }), 422);
    await expectStatus(updateParticipant(await actorFor(db, "rafael"), sofiaP, { areaId: palco }), [403, 404]);
  });

  it("o Produtor executivo continua sem área", async () => {
    await expectStatus(
      createParticipant(await actorFor(db, "marina"), { eventId: ev, name: "Exec", email: "exec-ac@x.dev", role: "PRODUTOR_EXECUTIVO", areaId: ceno }),
      422,
    );
    await expectPgError(
      owner.participant.create({ data: { eventId: ev, name: "Exec", email: "exec2-ac@x.dev", role: "PRODUTOR_EXECUTIVO", areaId: ceno } }),
      "23514",
    );
  });
});

describe("antes de o diretor dar a área", () => {
  it("o Head não vê nem age em Cenografia, nem marca as caixas da pré-produtora de lá", async () => {
    const r = await actorFor(db, "rafael");
    expect(headCovers(r, ev, ceno)).toBe(false);
    expect((await listOccurrences(r, ev)).map((o) => o.id)).not.toContain(occCeno);
    expect((await listParticipants(r, ev)).map((p) => p.id)).not.toContain(sofiaP);
    expect(canAssignRole(r, { eventId: ev, areaId: ceno, role: "OPERACIONAL" })).toBe(false);
    await expectStatus(setProducerAccess(r, sofiaP, { sections: ["ITENS"] }), [403, 404]);
    expect(await listProducerAccess(r, ev)).toEqual({});
    expect(await as("rafael", (tx) => tx.occurrence.count({ where: { id: occCeno } }))).toBe(0);
  });
});

describe("áreas correlacionadas", () => {
  it("só o diretor dá; o Gerente, o Head e o pré-produtor não", async () => {
    for (const p of ["marina", "rafael", "sofia"] as const) {
      await expectStatus(setHeadAreas(await actorFor(db, p), rafaelP, { areaIds: [ceno] }), [403, 404]);
    }
    await expectPgError(
      as("marina", (tx) => tx.headArea.create({ data: { eventId: ev, participantId: rafaelP, areaId: ceno, grantedById: d.users.marina! } })),
      "42501",
    );
    expect(await listHeadAreas(await actorFor(db, "marina"), ev)).toBeNull();
  });

  it("vale só para Head e só para outra área do evento", async () => {
    const admin = await actorFor(db, "admin");
    await expectStatus(setHeadAreas(admin, sofiaP, { areaIds: [palco] }), 422);
    await expectStatus(setHeadAreas(admin, rafaelP, { areaIds: [d.areas.infra.id] }), 404);
    await expectPgError(owner.headArea.create({ data: { eventId: ev, participantId: rafaelP, areaId: palco } }), "23514");
    await expectPgError(owner.headArea.create({ data: { eventId: ev, participantId: sofiaP, areaId: ceno } }), "23514");
  });

  it("o diretor dá Cenografia: o Head passa a ver e agir lá, e não em A&B", async () => {
    const admin = await actorFor(db, "admin");
    expect(await setHeadAreas(admin, rafaelP, { areaIds: [ceno, palco] })).toEqual({ areaIds: [ceno] });
    expect((await listHeadAreas(admin, ev))![rafaelP]).toEqual([ceno]);
    expect(await owner.auditLog.count({ where: { entity: "head_areas", entityId: rafaelP } })).toBe(1);

    const r = await actorFor(db, "rafael");
    expect(headCovers(r, ev, ceno)).toBe(true);
    expect(headCovers(r, ev, ab)).toBe(false);
    expect(canSeeTeam(r, { eventId: ev, areaId: ceno, teamId: marceneiros })).toBe(true);
    expect(canSeeOccurrence(r, { eventId: ev, areaId: ab })).toBe(false);
    expect((await listOccurrences(r, ev)).map((o) => o.id)).toContain(occCeno);
    expect((await listParticipants(r, ev)).map((p) => p.id)).toContain(sofiaP);
    const op = await createParticipant(r, { eventId: ev, name: "Marceneiro", email: "marceneiro-ac@x.dev", role: "OPERACIONAL", teamId: marceneiros });
    expect(op.areaId).toBe(ceno);
    await createOccurrence(r, { teamId: marceneiros, title: "Falta parafuso" });
    expect(await as("rafael", (tx) => tx.occurrence.count({ where: { id: occCeno } }))).toBe(1);
  });
});

describe("o Head marca as caixas dos produtores da área", () => {
  it("marca as de trabalho; as de valores e do cliente ficam com o gestor", async () => {
    const r = await actorFor(db, "rafael");
    expect(await listProducerAccess(r, ev)).toEqual({ [sofiaP]: { sections: [], editable: HEAD_SECTIONS } });
    expect(await setProducerAccess(r, sofiaP, { sections: ["ITENS", "COTACOES", "ORCAMENTO", "FINANCEIRO"] })).toEqual({ sections: ["ITENS", "COTACOES"] });

    await setProducerAccess(await actorFor(db, "marina"), sofiaP, { sections: ["ITENS", "COTACOES", "ORCAMENTO"] });
    expect(await setProducerAccess(r, sofiaP, { sections: [] })).toEqual({ sections: ["ORCAMENTO"] });
    expect((await actorFor(db, "sofia")).memberships.find((m) => m.eventId === ev)!.sections).toEqual(["ORCAMENTO"]);
  });

  it("no banco: o Head não liga nem desliga as caixas de valores e do cliente", async () => {
    await expectPgError(
      as("rafael", (tx) => tx.producerAccess.update({ where: { participantId: sofiaP }, data: { sections: [], updatedById: d.users.rafael! } })),
      "42501",
    );
    await expectPgError(
      as("rafael", (tx) => tx.producerAccess.update({ where: { participantId: sofiaP }, data: { sections: ["ORCAMENTO", "ATENDIMENTO"], updatedById: d.users.rafael! } })),
      "42501",
    );
    await as("rafael", (tx) => tx.producerAccess.update({ where: { participantId: sofiaP }, data: { sections: ["ORCAMENTO", "VISITAS"], updatedById: d.users.rafael! } }));
  });

  it("tirada a área, o Head perde Cenografia e as caixas da pré-produtora", async () => {
    await setHeadAreas(await actorFor(db, "admin"), rafaelP, { areaIds: [] });
    const r = await actorFor(db, "rafael");
    expect(headCovers(r, ev, ceno)).toBe(false);
    expect((await listOccurrences(r, ev)).map((o) => o.id)).not.toContain(occCeno);
    await expectStatus(setProducerAccess(r, sofiaP, { sections: ["ITENS"] }), [403, 404]);
    expect((await as("rafael", (tx) => tx.producerAccess.updateMany({ where: { participantId: sofiaP }, data: { sections: [], updatedById: d.users.rafael! } }))).count).toBe(0);
  });
});

describe("paridade app × banco nas áreas", () => {
  it("head_covers e can_grant_sections_for batem com a política", async () => {
    await setHeadAreas(await actorFor(db, "admin"), rafaelP, { areaIds: [ceno] });
    for (const p of ["admin", "marina", "rafael", "sofia", "paulo"] as const) {
      const a = await actorFor(db, p);
      for (const area of [palco, ceno, ab]) {
        const [row] = await as(p, (tx) => tx.$queryRaw<{ v: boolean }[]>`SELECT app.head_covers(${ev}::uuid, ${area}::uuid) AS v`);
        expect([p, area, row.v]).toEqual([p, area, headCovers(a, ev, area)]);
      }
      const [g] = await as(p, (tx) => tx.$queryRaw<{ v: boolean }[]>`SELECT app.can_grant_sections_for(${ev}::uuid, ${sofiaP}::uuid) AS v`);
      expect([p, g.v]).toEqual([p, canGrantSectionsFor(a, ev, { role: "PRE_PRODUTOR", areaId: ceno })]);
    }
    expect(SECTIONS.filter((s) => !HEAD_SECTIONS.includes(s))).toEqual(["EXECUTIVO", "ATENDIMENTO", "ORCAMENTO", "FINANCEIRO"]);
  });
});
