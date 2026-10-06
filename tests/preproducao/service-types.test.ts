import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectPgError, expectStatus, type Person } from "../helpers";
import { withUser, type Tx } from "@/server/db/with-user";
import {
  createServiceType,
  getServiceType,
  listServiceTypes,
  proposeSla,
  reviewSla,
  setServiceTypePerson,
  updateServiceType,
} from "@/modules/service-types/service-types.service";
import { createOccurrence, reassignOccurrence } from "@/modules/occurrences/occurrences.service";
import { targetMinutes } from "@/modules/occurrences/sla";

/**
 * Pré-produção, etapa 1: tipos de atendimento, SLA proposto por quem executa e
 * revisto pelo gestor, e "quem faz o quê". Pela camada de serviço (o caminho
 * da API e das telas) e direto no banco (a RLS segura sozinha).
 */

const db = appDb();
const d = demo();
afterAll(() => db.$disconnect());

const rock = d.events.rock.id;
const uniq = () => Math.random().toString(36).slice(2, 8);
const as = <T>(p: Person, fn: (tx: Tx) => Promise<T>) => withUser(db, d.users[p]!, fn);
const minutesFromNow = (due: Date | null, opened: Date) => Math.round((due!.getTime() - opened.getTime()) / 60_000);

let typeId: string;

beforeAll(async () => {
  const rafael = await actorFor(db, "rafael");
  const t = await createServiceType(rafael, { teamId: d.teams.eletrica.id, name: `Troca de disjuntor ${uniq()}` });
  typeId = t.id;
});

describe("criar tipos de atendimento", () => {
  it("Head cria na própria área e já pode definir o SLA", async () => {
    const rafael = await actorFor(db, "rafael");
    const t = await createServiceType(rafael, { teamId: d.teams.estrutura.id, name: `Grade solta ${uniq()}`, slaMinutes: 45 });
    expect(t.slaMinutes).toBe(45);
    const detail = await getServiceType(rafael, t.id);
    expect(detail.proposals[0]).toMatchObject({ status: "APROVADA", minutes: 45, approvedMinutes: 45 });
  });

  it("Head de outra área, Operacional e Cliente não criam", async () => {
    for (const person of ["beatriz", "joao", "claudia"] as const) {
      const actor = await actorFor(db, person);
      // Beatriz não enxerga a equipe (404); João e a Cliente enxergam, mas não podem (403).
      await expectStatus(
        createServiceType(actor, { teamId: d.teams.eletrica.id, name: `Indevido ${uniq()}` }),
        person === "beatriz" ? 404 : 403,
      );
    }
  });

  it("nome repetido na mesma equipe é recusado", async () => {
    const marina = await actorFor(db, "marina");
    const name = `Duplicado ${uniq()}`;
    await createServiceType(marina, { teamId: d.teams.bar.id, name });
    await expectStatus(createServiceType(marina, { teamId: d.teams.bar.id, name: name.toUpperCase() }), 422);
  });

  it("cada um só lista os tipos das equipes que enxerga", async () => {
    const marina = await actorFor(db, "marina");
    await createServiceType(marina, { teamId: d.teams.bar.id, name: `Troca de barril ${uniq()}` });
    const ana = await actorFor(db, "ana");
    expect((await listServiceTypes(ana, rock)).every((t) => t.teamId === d.teams.cenografia.id)).toBe(true);
    const joao = await actorFor(db, "joao");
    expect((await listServiceTypes(joao, rock)).every((t) => t.teamId === d.teams.eletrica.id)).toBe(true);
    expect((await listServiceTypes(joao, rock)).map((t) => t.id)).toContain(typeId);
    await expectStatus(getServiceType(ana, typeId), 404);
  });
});

describe("SLA proposto por quem executa e revisto pelo gestor", () => {
  it("João propõe; só existe uma proposta aguardando por vez", async () => {
    const joao = await actorFor(db, "joao");
    const p = await proposeSla(joao, typeId, { minutes: 40, note: "Precisa buscar peça no almoxarifado" });
    expect(p.status).toBe("PENDENTE");
    await expectStatus(proposeSla(joao, typeId, { minutes: 30 }), 409);
    const list = await listServiceTypes(joao, rock);
    expect(list.find((t) => t.id === typeId)?.pending?.minutes).toBe(40);
  });

  it("quem é de outra equipe não propõe; Operacional não revê", async () => {
    const ana = await actorFor(db, "ana");
    await expectStatus(proposeSla(ana, typeId, { minutes: 10 }), 404);
    const joao = await actorFor(db, "joao");
    const pending = (await getServiceType(joao, typeId)).proposals.find((p) => p.status === "PENDENTE")!;
    await expectStatus(reviewSla(joao, pending.id, { decision: "APROVAR" }), 403);
    const beatriz = await actorFor(db, "beatriz");
    await expectStatus(reviewSla(beatriz, pending.id, { decision: "APROVAR" }), 404);
  });

  it("ajustar exige comentário; o ajuste vira o SLA do tipo e João vê o retorno", async () => {
    const rafael = await actorFor(db, "rafael");
    const pending = (await getServiceType(rafael, typeId)).proposals.find((p) => p.status === "PENDENTE")!;
    await expectStatus(reviewSla(rafael, pending.id, { decision: "AJUSTAR", minutes: 30 }), 422);
    await reviewSla(rafael, pending.id, { decision: "AJUSTAR", minutes: 30, feedback: "Deixe a peça no palco antes do show" });
    await expectStatus(reviewSla(rafael, pending.id, { decision: "RECUSAR", feedback: "x" }), 409);

    const joao = await actorFor(db, "joao");
    const detail = await getServiceType(joao, typeId);
    expect(detail.slaMinutes).toBe(30);
    expect(detail.proposals[0]).toMatchObject({
      status: "AJUSTADA", minutes: 40, approvedMinutes: 30, feedback: "Deixe a peça no palco antes do show",
      proposedBy: { name: "João" }, reviewedBy: { name: "Rafael Head Infra" },
    });
  });

  it("recusar mantém o SLA anterior", async () => {
    const carlos = await actorFor(db, "carlos");
    const p = await proposeSla(carlos, typeId, { minutes: 120 });
    const marina = await actorFor(db, "marina");
    await reviewSla(marina, p.id, { decision: "RECUSAR", feedback: "Duas horas é muito durante o show" });
    expect((await getServiceType(marina, typeId)).slaMinutes).toBe(30);
  });
});

describe("chamado com tipo de atendimento", () => {
  it("usa o SLA do tipo; Crítica não fica mais lenta que o prazo de Crítica", async () => {
    const rafael = await actorFor(db, "rafael");
    const normal = await createOccurrence(rafael, { teamId: d.teams.eletrica.id, title: `Disjuntor ${uniq()}`, serviceTypeId: typeId });
    expect(minutesFromNow(normal.slaDueAt, normal.openedAt)).toBe(30);
    const critica = await createOccurrence(rafael, {
      teamId: d.teams.eletrica.id, title: `Disjuntor ${uniq()}`, serviceTypeId: typeId, priority: "CRITICA", status: "URGENTE",
    });
    expect(minutesFromNow(critica.slaDueAt, critica.openedAt)).toBe(15);
    const semTipo = await createOccurrence(rafael, { teamId: d.teams.eletrica.id, title: `Sem tipo ${uniq()}` });
    expect(minutesFromNow(semTipo.slaDueAt, semTipo.openedAt)).toBe(240);
  });

  it("tipo de outra equipe é recusado; trocar de equipe tira o tipo", async () => {
    const rafael = await actorFor(db, "rafael");
    await expectStatus(
      createOccurrence(rafael, { teamId: d.teams.estrutura.id, title: `Errado ${uniq()}`, serviceTypeId: typeId }),
      422,
    );
    const o = await createOccurrence(rafael, { teamId: d.teams.eletrica.id, title: `Muda ${uniq()}`, serviceTypeId: typeId });
    const moved = await reassignOccurrence(rafael, o.id, { teamId: d.teams.estrutura.id });
    expect(moved.serviceTypeId).toBeNull();
  });

  it("regra de prazo", () => {
    expect(targetMinutes("NORMAL", 240, null)).toBe(240);
    expect(targetMinutes("NORMAL", 240, 30)).toBe(30);
    expect(targetMinutes("BAIXA", 1440, 600)).toBe(600);
    expect(targetMinutes("CRITICA", 15, 30)).toBe(15);
    expect(targetMinutes("CRITICA", 15, 10)).toBe(10);
  });
});

describe("quem faz o quê", () => {
  it("o gestor marca e desmarca pessoas da área; de fora da área não", async () => {
    const rafael = await actorFor(db, "rafael");
    await setServiceTypePerson(rafael, typeId, { participantId: d.participants.joao.id, does: true });
    await setServiceTypePerson(rafael, typeId, { participantId: d.participants.joao.id, does: true });
    expect((await getServiceType(rafael, typeId)).people.map((p) => p.id)).toEqual([d.participants.joao.id]);
    const marina = await actorFor(db, "marina");
    await expectStatus(setServiceTypePerson(marina, typeId, { participantId: d.participants.beatriz.id, does: true }), 422);
    await setServiceTypePerson(rafael, typeId, { participantId: d.participants.joao.id, does: false });
    expect((await getServiceType(rafael, typeId)).people).toEqual([]);
  });

  it("Operacional não marca ninguém", async () => {
    const joao = await actorFor(db, "joao");
    await expectStatus(setServiceTypePerson(joao, typeId, { participantId: d.participants.carlos.id, does: true }), 403);
  });

  it("arquivar tira o tipo da lista", async () => {
    const rafael = await actorFor(db, "rafael");
    const t = await createServiceType(rafael, { teamId: d.teams.cenografia.id, name: `Arquivar ${uniq()}` });
    await updateServiceType(rafael, t.id, { archived: true });
    expect((await listServiceTypes(rafael, rock)).map((x) => x.id)).not.toContain(t.id);
  });
});

describe("direto no banco (sem o backend)", () => {
  const RLS = "42501";

  it("Operacional não cria tipo, não aprova a própria proposta e não muda o SLA", async () => {
    const t = (await as("rafael", (tx) => tx.serviceType.findUniqueOrThrow({ where: { id: typeId } })));
    const base = { eventId: t.eventId, areaId: t.areaId, teamId: t.teamId };
    await expectPgError(
      as("joao", (tx) => tx.serviceType.create({ data: { ...base, name: `Hack ${uniq()}`, createdById: d.users.joao! } })),
      RLS,
    );
    await expectPgError(
      as("joao", (tx) => tx.slaProposal.create({
        data: {
          ...base, serviceTypeId: t.id, minutes: 5, status: "APROVADA", approvedMinutes: 5,
          proposedById: d.users.joao!, reviewedById: d.users.joao!, reviewedAt: new Date(),
        },
      })),
      RLS,
    );
    // Em nome de outra pessoa também não.
    await expectPgError(
      as("joao", (tx) => tx.slaProposal.create({ data: { ...base, serviceTypeId: t.id, minutes: 5, proposedById: d.users.carlos! } })),
      RLS,
    );
    const changed = await as("joao", (tx) => tx.serviceType.updateMany({ where: { id: t.id }, data: { slaMinutes: 1 } }));
    expect(changed.count).toBe(0);
    await expectPgError(
      as("joao", (tx) => tx.serviceTypePerson.create({ data: { ...base, serviceTypeId: t.id, participantId: d.participants.joao.id } })),
      RLS,
    );
  });

  it("Head de A&B não enxerga tipos da Infra; a Cliente enxerga mas não altera", async () => {
    expect(await as("beatriz", (tx) => tx.serviceType.count({ where: { id: typeId } }))).toBe(0);
    expect(await as("claudia", (tx) => tx.serviceType.count({ where: { id: typeId } }))).toBe(1);
    const changed = await as("claudia", (tx) => tx.serviceType.updateMany({ where: { id: typeId }, data: { name: "x" } }));
    expect(changed.count).toBe(0);
  });

  it("tipo não muda de equipe e proposta revista não volta a ser revista", async () => {
    await expectPgError(
      as("rafael", (tx) => tx.serviceType.update({ where: { id: typeId }, data: { teamId: d.teams.estrutura.id } })),
      "23514",
    );
    const reviewed = await as("rafael", (tx) => tx.slaProposal.findFirstOrThrow({ where: { serviceTypeId: typeId, status: "AJUSTADA" } }));
    await expectPgError(
      as("rafael", (tx) => tx.slaProposal.update({ where: { id: reviewed.id }, data: { status: "RECUSADA", approvedMinutes: null } })),
      "23514",
    );
  });
});
