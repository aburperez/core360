import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectPgError, expectStatus, ownerDb, type Person } from "../helpers";
import { withUser, type Tx } from "@/server/db/with-user";
import { canAssignRole, canUseField, canUsePreProduction, canUseSection } from "@/server/authz/policy";
import { EXECUTIVE_SECTIONS, SECTIONS } from "@/server/authz/sections";
import { createEvent } from "@/modules/events/events.service";
import { createParticipant } from "@/modules/participants/participants.service";
import { listProducerAccess, setProducerAccess } from "@/modules/participants/producer-access.service";
import { setClientView } from "@/modules/participants/client-views.service";
import { createCostItem, createCostSection, updateCostItem } from "@/modules/costs/costs.service";
import { listItemMap } from "@/modules/items/items.service";
import { getBudget } from "@/modules/items/budget.service";
import { createMilestone, getSchedule } from "@/modules/schedule/schedule.service";
import { createTask, listPendencies } from "@/modules/pendencies/pendencies.service";
import { listDocuments } from "@/modules/documents/documents.service";
import { getFunctionsPanel } from "@/modules/functions/functions.service";
import { listQuotes } from "@/modules/quotes/quotes.service";
import { getExecutivePanel } from "@/modules/panels/panels.service";
import { getFinancialClosing, updatePayment } from "@/modules/finance/closing.service";

/**
 * Hierarquia de acessos, etapa 1 (Abu, 2026-10-20): o Pré-produtor abre só as
 * partes da Pré-produção marcadas para ele (o Gerente ou o diretor marca); o
 * Produtor executivo tem partes fixas (financeiro, orçamento, briefing,
 * produtores, estrutura e cenografia, atendimento). Pelo serviço e no banco.
 */

const db = appDb();
const owner = ownerDb();
const d = demo();
const as = <T>(p: Person, fn: (tx: Tx) => Promise<T>) => withUser(db, d.users[p]!, fn);

let ev: string;
let sofiaP: string;
let anaP: string;
let claudiaP: string;
let cenario: string;
let som: string;

beforeAll(async () => {
  ev = (await createEvent(await actorFor(db, "admin"), { clientId: d.clients.rock.id, name: "Feira da hierarquia", startsAt: "2027-12-10T10:00", endsAt: "2027-12-12T22:00" })).id;
  const area = (await owner.area.create({ data: { eventId: ev, name: "Palco" } })).id;
  const join = (p: Person, role: "GERENTE" | "PRE_PRODUTOR" | "PRODUTOR_EXECUTIVO" | "HEAD" | "CLIENTE") =>
    owner.participant.create({ data: { eventId: ev, userId: d.users[p]!, name: p, email: `${p}-hq@rockfestival.dev`, role, areaId: role === "HEAD" ? area : undefined, joinedAt: new Date() } });
  await join("marina", "GERENTE");
  sofiaP = (await join("sofia", "PRE_PRODUTOR")).id;
  anaP = (await join("ana", "PRODUTOR_EXECUTIVO")).id;
  claudiaP = (await join("claudia", "CLIENTE")).id;
  await join("rafael", "HEAD");

  const m = await actorFor(db, "marina");
  const section = (await createCostSection(m, ev, { name: "Estruturas" })).id;
  cenario = (await createCostItem(m, section, { name: "Cenário do palco", quantity: 1, frequency: 1, unitValue: 30_000 })).id;
  som = (await createCostItem(m, section, { name: "Som", quantity: 1, frequency: 1, unitValue: 20_000 })).id;
  await updateCostItem(m, cenario, { category: "CENOGRAFIA", contractedValue: 28_000 });
  await updateCostItem(m, som, { category: "AUDIOVISUAL" });
});

afterAll(async () => {
  await owner.event.update({ where: { id: ev }, data: { deletedAt: new Date() } });
  await Promise.all([db.$disconnect(), owner.$disconnect()]);
});

describe("Pré-produtor sem caixas", () => {
  it("entra na Pré-produção, mas nenhuma parte abre", async () => {
    const s = await actorFor(db, "sofia");
    expect(canUsePreProduction(s, ev)).toBe(true);
    expect(SECTIONS.filter((x) => canUseSection(s, ev, x))).toEqual([]);
    await expectStatus(getSchedule(s, ev), 404);
    await expectStatus(listDocuments(s, ev), 404);
    await expectStatus(getFunctionsPanel(s, ev), 404);
    await expectStatus(listItemMap(s, ev), 404);
    await expectStatus(listPendencies(s, ev), 404);
  });

  it("no banco também: não grava em nenhuma parte e não lê as sigilosas", async () => {
    await expectPgError(
      as("sofia", (tx) => tx.eventTask.create({ data: { eventId: ev, title: "x", createdById: d.users.sofia! } })),
      "42501",
    );
    await expectPgError(
      as("sofia", (tx) => tx.eventMilestone.create({ data: { eventId: ev, title: "x", dueOn: new Date("2027-11-22"), createdById: d.users.sofia! } })),
      "42501",
    );
    expect((await as("sofia", (tx) => tx.costItem.updateMany({ where: { eventId: ev }, data: { notes: "x" } }))).count).toBe(0);
    expect(await as("sofia", (tx) => tx.eventMilestone.count({ where: { eventId: ev } }))).toBe(0);
    expect(await owner.eventMilestone.count({ where: { eventId: ev } })).toBeGreaterThan(0);
  });
});

describe("caixas de acesso", () => {
  it("o Gerente marca; o Pré-produtor abre só o que foi marcado", async () => {
    const m = await actorFor(db, "marina");
    expect(await setProducerAccess(m, sofiaP, { sections: ["DOCUMENTOS", "CRONOGRAMA"] })).toEqual({ sections: ["CRONOGRAMA", "DOCUMENTOS"] });
    expect((await listProducerAccess(m, ev))![sofiaP]).toEqual(["CRONOGRAMA", "DOCUMENTOS"]);
    expect(await owner.auditLog.count({ where: { entity: "producer_access", entityId: sofiaP } })).toBe(1);

    const s = await actorFor(db, "sofia");
    expect((await getSchedule(s, ev)).progress.total).toBeGreaterThan(0);
    await listDocuments(s, ev);
    await createMilestone(s, ev, { title: "Pedir alvará", dueOn: "2027-11-22" });
    await expectStatus(listPendencies(s, ev), 404);
    await expectStatus(createTask(s, ev, { title: "Conferir credenciais" }), 404);
    await expectPgError(
      as("sofia", (tx) => tx.eventTask.create({ data: { eventId: ev, title: "x", createdById: d.users.sofia! } })),
      "42501",
    );
  });

  it("desmarcar tira o acesso na hora", async () => {
    await setProducerAccess(await actorFor(db, "marina"), sofiaP, { sections: [] });
    await expectStatus(getSchedule(await actorFor(db, "sofia"), ev), 404);
    await setProducerAccess(await actorFor(db, "admin"), sofiaP, { sections: ["CRONOGRAMA"] });
    await getSchedule(await actorFor(db, "sofia"), ev);
  });

  it("só o Gerente e o diretor marcam; só para Pré-produtor; só partes que existem", async () => {
    for (const p of ["sofia", "ana", "rafael", "claudia", "paulo"] as const) {
      await expectStatus(setProducerAccess(await actorFor(db, p), sofiaP, { sections: [...SECTIONS] }), [403, 404]);
    }
    expect(await listProducerAccess(await actorFor(db, "sofia"), ev)).toBeNull();
    const m = await actorFor(db, "marina");
    await expectStatus(setProducerAccess(m, anaP, { sections: ["ORCAMENTO"] }), 422);
    await expectStatus(setProducerAccess(m, sofiaP, { sections: ["CAMPO"] }), 422);
  });

  it("no banco: ninguém marca para si, e as caixas valem só para Pré-produtor", async () => {
    expect((await as("sofia", (tx) => tx.producerAccess.updateMany({ where: { participantId: sofiaP }, data: { sections: [...SECTIONS], updatedById: d.users.sofia! } }))).count).toBe(0);
    await expectPgError(
      as("marina", (tx) => tx.producerAccess.update({ where: { participantId: sofiaP }, data: { sections: ["ITENS"], updatedById: d.users.paulo! } })),
      "42501",
    );
    await expectPgError(owner.producerAccess.create({ data: { eventId: ev, participantId: anaP, sections: ["ITENS"] } }), "23514");
    await expectPgError(owner.producerAccess.update({ where: { participantId: sofiaP }, data: { sections: ["CAMPO"] } }), "23514");
  });
});

describe("Produtor executivo", () => {
  it("só o Gerente e o diretor colocam alguém como executivo; ele é do evento, sem área", async () => {
    const m = await actorFor(db, "marina");
    expect(canAssignRole(m, { eventId: ev, role: "PRODUTOR_EXECUTIVO" })).toBe(true);
    expect(canAssignRole(await actorFor(db, "rafael"), { eventId: ev, role: "PRODUTOR_EXECUTIVO" })).toBe(false);
    expect(canAssignRole(await actorFor(db, "ana"), { eventId: ev, role: "PRE_PRODUTOR" })).toBe(false);
    const p = await createParticipant(m, { eventId: ev, name: "Executivo Novo", email: "exec-hq@x.dev", role: "PRODUTOR_EXECUTIVO" });
    expect(p.role).toBe("PRODUTOR_EXECUTIVO");
    await expectStatus(createParticipant(await actorFor(db, "rafael"), { eventId: ev, name: "X", email: "x-hq@x.dev", role: "PRODUTOR_EXECUTIVO" }), 403);
    await expectPgError(
      owner.participant.create({ data: { eventId: ev, name: "Y", email: "y-hq@x.dev", role: "PRODUTOR_EXECUTIVO", areaId: (await owner.area.findFirstOrThrow({ where: { eventId: ev } })).id } }),
      "23514",
    );
  });

  it("abre as partes fixas e fica fora do campo", async () => {
    const a = await actorFor(db, "ana");
    expect(canUseField(a, ev)).toBe(false);
    expect(SECTIONS.filter((x) => canUseSection(a, ev, x)).sort()).toEqual([...EXECUTIVE_SECTIONS].sort());
    await getBudget(a, ev);
    await getExecutivePanel(a, ev);
    await getFunctionsPanel(a, ev);
    await listDocuments(a, ev);
    await expectStatus(getSchedule(a, ev), 404);
    await expectStatus(listQuotes(a, ev), 404);
    await expectStatus(listPendencies(a, ev), 404);
  });

  it("no Mapa de itens vê só estrutura e cenografia", async () => {
    const a = await listItemMap(await actorFor(db, "ana"), ev);
    expect(a.structureOnly).toBe(true);
    expect(a.items.map((i) => i.name)).toEqual(["Cenário do palco"]);
    expect(a.total).toBe(1);
    const m = await listItemMap(await actorFor(db, "marina"), ev);
    expect(m.items.map((i) => i.name).sort()).toEqual(["Cenário do palco", "Som"]);
  });

  it("financeiro: lança realizado e pagamento, também no banco; o Pré-produtor não", async () => {
    const a = await actorFor(db, "ana");
    const c = await getFinancialClosing(a, ev);
    expect(c.can.edit).toBe(true);
    await updatePayment(a, cenario, { actualValue: 28_000, paidOn: "2027-12-15", invoiceNumber: "NF 10" });
    await updateCostItem(a, som, { contractedValue: 19_000 });
    expect(Number((await owner.costItem.findUniqueOrThrow({ where: { id: som } })).contractedValue)).toBe(19_000);

    await setProducerAccess(await actorFor(db, "marina"), sofiaP, { sections: ["FINANCEIRO", "ORCAMENTO"] });
    const s = await actorFor(db, "sofia");
    expect((await getFinancialClosing(s, ev)).can.edit).toBe(false);
    await expectStatus(updatePayment(s, cenario, { invoiceNumber: "NF 99" }), 404);
    await expectStatus(updateCostItem(s, som, { actualValue: 1 }), 403);
    await expectPgError(as("sofia", (tx) => tx.costItem.update({ where: { id: som }, data: { actualValue: 1 } })), "42501");
  });

  it("atendimento: decide o que o Cliente vê", async () => {
    expect(await setClientView(await actorFor(db, "ana"), claudiaP, { progress: true })).toMatchObject({ progress: true });
    await expectStatus(setClientView(await actorFor(db, "sofia"), claudiaP, { costs: true }), [403, 404]);
  });
});

describe("paridade backend × banco neste evento", () => {
  it("as mesmas respostas para Gerente, executivo, Pré-produtor, Head, Cliente e diretor", async () => {
    const roles = ["GERENTE", "PRODUTOR_EXECUTIVO", "HEAD", "OPERACIONAL", "CLIENTE", "PRE_PRODUTOR"] as const;
    const mismatches: string[] = [];
    for (const person of ["admin", "marina", "ana", "sofia", "rafael", "claudia"] as const) {
      const actor = await actorFor(db, person);
      await as(person, async (tx) => {
        const q = async (sql: string, ...args: unknown[]) => (await tx.$queryRawUnsafe<{ r: boolean }[]>(sql, ...args))[0].r;
        const check = (label: string, ts: boolean, sql: boolean) => {
          if (ts !== sql) mismatches.push(`${person} ${label}: backend=${ts} banco=${sql}`);
        };
        for (const sec of SECTIONS) {
          check(`abrir ${sec}`, canUseSection(actor, ev, sec), await q(`SELECT app.has_section($1::uuid, ARRAY[$2]::text[]) AS r`, ev, sec));
        }
        check("Pré-produção", canUsePreProduction(actor, ev), await q(`SELECT app.can_use_pre_production($1::uuid) AS r`, ev));
        check("campo", canUseField(actor, ev), await q(`SELECT app.can_use_field($1::uuid) AS r`, ev));
        for (const role of roles) {
          check(`atribuir ${role}`, canAssignRole(actor, { eventId: ev, role }), await q(`SELECT app.can_assign_role($1::uuid, $2::participant_role, NULL) AS r`, ev, role));
        }
      });
    }
    expect(mismatches).toEqual([]);
  });
});
