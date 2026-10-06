import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectPgError, expectStatus, type Person } from "../helpers";
import { withUser, type Tx } from "@/server/db/with-user";
import {
  createServiceType,
  getServiceType,
  listServiceTypes,
  listServiceTypesForTickets,
  proposeSla,
  reviewSla,
  setServiceTypePerson,
  updateServiceType,
} from "@/modules/service-types/service-types.service";
import { createOccurrence, listOccurrences, reassignOccurrence } from "@/modules/occurrences/occurrences.service";
import { createParticipant } from "@/modules/participants/participants.service";
import { getDashboard } from "@/modules/dashboard/dashboard.service";
import { targetMinutes } from "@/modules/occurrences/sla";

/**
 * Pré-produção separada do campo: só a Pré-produtora (Sofia) e o gestor
 * (Gerente Marina, ou Admin) entram. Sofia propõe o SLA; só a Gerente aprova,
 * ajusta, recusa ou define. O campo só lê nome e prazo dos tipos ao abrir um
 * chamado. Pela camada de serviço e direto no banco (a RLS segura sozinha).
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
  const sofia = await actorFor(db, "sofia");
  const t = await createServiceType(sofia, { teamId: d.teams.eletrica.id, name: `Troca de disjuntor ${uniq()}` });
  typeId = t.id;
});

describe("quem entra na Pré-produção", () => {
  it("Pré-produtora e Gerente entram; Head, Operacional e Cliente não", async () => {
    for (const person of ["sofia", "marina", "admin"] as const) {
      const actor = await actorFor(db, person);
      expect((await listServiceTypes(actor, rock)).map((t) => t.id)).toContain(typeId);
    }
    for (const person of ["rafael", "joao", "claudia"] as const) {
      const actor = await actorFor(db, person);
      await expectStatus(listServiceTypes(actor, rock), 404);
      await expectStatus(getServiceType(actor, typeId), 404);
      await expectStatus(createServiceType(actor, { teamId: d.teams.eletrica.id, name: `Indevido ${uniq()}` }), 404);
      await expectStatus(proposeSla(actor, typeId, { minutes: 10 }), 404);
    }
  });

  it("Gerente de outro evento não entra", async () => {
    const paulo = await actorFor(db, "paulo");
    await expectStatus(listServiceTypes(paulo, rock), 404);
    await expectStatus(getServiceType(paulo, typeId), 404);
  });

  it("Pré-produtora não vê o campo: painel, chamados e abertura de chamado", async () => {
    const sofia = await actorFor(db, "sofia");
    expect(await listOccurrences(sofia, rock)).toEqual([]);
    await expectStatus(createOccurrence(sofia, { teamId: d.teams.eletrica.id, title: `Indevido ${uniq()}` }), 403);
    const dash = await getDashboard(sofia, rock);
    expect("totals" in dash ? dash.totals.total : 0).toBe(0);
  });

  it("só a Gerente coloca alguém como Pré-produtor, sempre sem área", async () => {
    const marina = await actorFor(db, "marina");
    const p = await createParticipant(marina, { eventId: rock, name: "Nova Pré", email: `pre.${uniq()}@x.dev`, role: "PRE_PRODUTOR" });
    expect(p.role).toBe("PRE_PRODUTOR");
    const rafael = await actorFor(db, "rafael");
    await expectStatus(createParticipant(rafael, { eventId: rock, name: "X", email: `x.${uniq()}@x.dev`, role: "PRE_PRODUTOR" }), 403);
    await expectPgError(
      as("marina", (tx) => tx.participant.create({
        data: { eventId: rock, name: "Y", email: `y.${uniq()}@x.dev`, role: "PRE_PRODUTOR", areaId: d.areas.infra.id },
      })),
      "23514",
    );
  });
});

describe("tipos de atendimento", () => {
  it("Pré-produtora cria; o SLA que ela informa vira proposta para a Gerente", async () => {
    const sofia = await actorFor(db, "sofia");
    const t = await createServiceType(sofia, { teamId: d.teams.estrutura.id, name: `Grade solta ${uniq()}`, slaMinutes: 45 });
    expect(t.slaMinutes).toBeNull();
    const detail = await getServiceType(sofia, t.id);
    expect(detail.proposals[0]).toMatchObject({ status: "PENDENTE", minutes: 45 });
    expect(detail.can).toEqual({ manage: true, review: false });
  });

  it("Gerente cria já com o SLA valendo", async () => {
    const marina = await actorFor(db, "marina");
    const t = await createServiceType(marina, { teamId: d.teams.bar.id, name: `Troca de barril ${uniq()}`, slaMinutes: 10 });
    expect(t.slaMinutes).toBe(10);
  });

  it("nome repetido na mesma equipe é recusado", async () => {
    const sofia = await actorFor(db, "sofia");
    const name = `Duplicado ${uniq()}`;
    await createServiceType(sofia, { teamId: d.teams.bar.id, name });
    await expectStatus(createServiceType(sofia, { teamId: d.teams.bar.id, name: name.toUpperCase() }), 422);
  });

  it("arquivar tira o tipo da lista", async () => {
    const sofia = await actorFor(db, "sofia");
    const t = await createServiceType(sofia, { teamId: d.teams.cenografia.id, name: `Arquivar ${uniq()}` });
    await updateServiceType(sofia, t.id, { archived: true });
    expect((await listServiceTypes(sofia, rock)).map((x) => x.id)).not.toContain(t.id);
  });
});

describe("SLA proposto pela Pré-produtora e revisto pela Gerente", () => {
  it("Sofia propõe; só existe uma proposta aguardando por vez; ela não revê", async () => {
    const sofia = await actorFor(db, "sofia");
    const p = await proposeSla(sofia, typeId, { minutes: 40, note: "Precisa buscar peça no almoxarifado" });
    expect(p.status).toBe("PENDENTE");
    await expectStatus(proposeSla(sofia, typeId, { minutes: 30 }), 409);
    await expectStatus(reviewSla(sofia, p.id, { decision: "APROVAR" }), 403);
    const rafael = await actorFor(db, "rafael");
    await expectStatus(reviewSla(rafael, p.id, { decision: "APROVAR" }), 404);
  });

  it("ajustar exige comentário; o ajuste vira o SLA e Sofia vê o retorno", async () => {
    const marina = await actorFor(db, "marina");
    const pending = (await getServiceType(marina, typeId)).proposals.find((p) => p.status === "PENDENTE")!;
    await expectStatus(reviewSla(marina, pending.id, { decision: "AJUSTAR", minutes: 30 }), 422);
    await reviewSla(marina, pending.id, { decision: "AJUSTAR", minutes: 30, feedback: "Deixe a peça no palco antes do show" });
    await expectStatus(reviewSla(marina, pending.id, { decision: "RECUSAR", feedback: "x" }), 409);

    const sofia = await actorFor(db, "sofia");
    const detail = await getServiceType(sofia, typeId);
    expect(detail.slaMinutes).toBe(30);
    expect(detail.proposals[0]).toMatchObject({
      status: "AJUSTADA", minutes: 40, approvedMinutes: 30, feedback: "Deixe a peça no palco antes do show",
      proposedBy: { name: "Sofia Pré-produtora" }, reviewedBy: { name: "Marina Gerente" },
    });
  });

  it("recusar mantém o SLA anterior", async () => {
    const sofia = await actorFor(db, "sofia");
    const p = await proposeSla(sofia, typeId, { minutes: 120 });
    const marina = await actorFor(db, "marina");
    await reviewSla(marina, p.id, { decision: "RECUSAR", feedback: "Duas horas é muito durante o show" });
    expect((await getServiceType(marina, typeId)).slaMinutes).toBe(30);
  });
});

describe("chamado de campo com tipo de atendimento", () => {
  it("quem abre o chamado vê nome e prazo dos tipos da própria equipe, sem a Pré-produção", async () => {
    const joao = await actorFor(db, "joao");
    const types = await listServiceTypesForTickets(joao, rock);
    expect(types.map((t) => t.id)).toContain(typeId);
    expect(types.every((t) => t.teamId === d.teams.eletrica.id)).toBe(true);
    expect(Object.keys(types[0]).sort()).toEqual(["areaId", "eventId", "id", "name", "slaMinutes", "teamId"]);
  });

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
  it("a Pré-produção marca e desmarca pessoas da área; de fora da área não", async () => {
    const sofia = await actorFor(db, "sofia");
    await setServiceTypePerson(sofia, typeId, { participantId: d.participants.joao.id, does: true });
    await setServiceTypePerson(sofia, typeId, { participantId: d.participants.joao.id, does: true });
    expect((await getServiceType(sofia, typeId)).people.map((p) => p.id)).toEqual([d.participants.joao.id]);
    await expectStatus(setServiceTypePerson(sofia, typeId, { participantId: d.participants.beatriz.id, does: true }), 422);
    await setServiceTypePerson(sofia, typeId, { participantId: d.participants.joao.id, does: false });
    expect((await getServiceType(sofia, typeId)).people).toEqual([]);
  });

  it("Head da área não marca", async () => {
    const rafael = await actorFor(db, "rafael");
    await expectStatus(setServiceTypePerson(rafael, typeId, { participantId: d.participants.carlos.id, does: true }), 404);
  });
});

describe("direto no banco (sem o backend)", () => {
  const RLS = "42501";
  const base = async () => {
    const t = await as("marina", (tx) => tx.serviceType.findUniqueOrThrow({ where: { id: typeId } }));
    return { t, scope: { eventId: t.eventId, areaId: t.areaId, teamId: t.teamId } };
  };

  it("Pré-produtora não aprova a própria proposta nem muda o SLA do tipo", async () => {
    const { t, scope } = await base();
    await expectPgError(
      as("sofia", (tx) => tx.slaProposal.create({
        data: {
          ...scope, serviceTypeId: t.id, minutes: 5, status: "APROVADA", approvedMinutes: 5,
          proposedById: d.users.sofia!, reviewedById: d.users.sofia!, reviewedAt: new Date(),
        },
      })),
      RLS,
    );
    await expectPgError(as("sofia", (tx) => tx.serviceType.update({ where: { id: t.id }, data: { slaMinutes: 1 } })), RLS);
    await expectPgError(
      as("sofia", (tx) => tx.serviceType.create({ data: { ...scope, name: `Com SLA ${uniq()}`, slaMinutes: 5, createdById: d.users.sofia! } })),
      RLS,
    );
    // Em nome de outra pessoa também não.
    await expectPgError(
      as("sofia", (tx) => tx.slaProposal.create({ data: { ...scope, serviceTypeId: t.id, minutes: 5, proposedById: d.users.marina! } })),
      RLS,
    );
  });

  it("Head, Operacional e Cliente: leem o tipo da equipe (chamado), mas nada da Pré-produção", async () => {
    const { t, scope } = await base();
    for (const person of ["rafael", "joao", "claudia"] as const) {
      expect(await as(person, (tx) => tx.serviceType.count({ where: { id: t.id } }))).toBe(1);
      expect(await as(person, (tx) => tx.slaProposal.count({ where: { serviceTypeId: t.id } }))).toBe(0);
      expect(await as(person, (tx) => tx.serviceTypePerson.count({ where: { serviceTypeId: t.id } }))).toBe(0);
      expect((await as(person, (tx) => tx.serviceType.updateMany({ where: { id: t.id }, data: { name: "x" } }))).count).toBe(0);
      await expectPgError(
        as(person, (tx) => tx.serviceType.create({ data: { ...scope, name: `Hack ${uniq()}`, createdById: d.users[person]! } })),
        RLS,
      );
    }
    await expectPgError(
      as("rafael", (tx) => tx.serviceTypePerson.create({ data: { ...scope, serviceTypeId: t.id, participantId: d.participants.joao.id } })),
      RLS,
    );
  });

  it("Pré-produtora não vê chamados", async () => {
    expect(await as("sofia", (tx) => tx.occurrence.count())).toBe(0);
  });

  it("tipo não muda de equipe e proposta revista não volta a ser revista", async () => {
    await expectPgError(
      as("marina", (tx) => tx.serviceType.update({ where: { id: typeId }, data: { teamId: d.teams.estrutura.id } })),
      "23514",
    );
    const reviewed = await as("marina", (tx) => tx.slaProposal.findFirstOrThrow({ where: { serviceTypeId: typeId, status: "AJUSTADA" } }));
    await expectPgError(
      as("marina", (tx) => tx.slaProposal.update({ where: { id: reviewed.id }, data: { status: "RECUSADA", approvedMinutes: null } })),
      "23514",
    );
  });
});
