import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectPgError, expectStatus, ownerDb, type Person } from "../helpers";
import { withUser, type Tx } from "@/server/db/with-user";
import { createEvent } from "@/modules/events/events.service";
import { createCostItem, createCostSection, deleteCostItem, updateCostItem } from "@/modules/costs/costs.service";
import {
  createDefaultMilestones,
  createMilestone,
  deleteMilestone,
  getSchedule,
  setMilestoneDone,
  updateMilestone,
} from "@/modules/schedule/schedule.service";

/**
 * Cronograma (fase 4A): o evento nasce com os marcos T-30 a T0, a
 * Pré-produção marca feito, muda e cria marcos; o item tem prazo e "depende
 * de" (sem círculo). O campo e o cliente não veem. Pelo serviço e no banco.
 */

const db = appDb();
const owner = ownerDb();
const d = demo();
const as = <T>(p: Person, fn: (tx: Tx) => Promise<T>) => withUser(db, d.users[p]!, fn);
const sofia = () => actorFor(db, "sofia");
const marina = () => actorFor(db, "marina");
// 20/11/2027 ao meio-dia em São Paulo: T-20 de um evento que começa em 10/12.
const NOW = new Date("2027-11-20T15:00:00Z");

let ev: string;
let sofiaP: string;
let claudiaP: string;

beforeAll(async () => {
  const e = await createEvent(await actorFor(db, "admin"), { clientId: d.clients.rock.id, name: "Feira do cronograma", startsAt: "2027-12-10T10:00", endsAt: "2027-12-12T22:00" });
  ev = e.id;
  const area = (await owner.area.create({ data: { eventId: ev, name: "Palco" } })).id;
  const join = (p: Person, role: "GERENTE" | "PRE_PRODUTOR" | "HEAD" | "CLIENTE") =>
    owner.participant.create({ data: { eventId: ev, userId: d.users[p]!, name: p, email: `${p}-cr@rockfestival.dev`, role, areaId: role === "HEAD" ? area : undefined, joinedAt: new Date() } });
  await join("marina", "GERENTE");
  sofiaP = (await join("sofia", "PRE_PRODUTOR")).id;
  await join("rafael", "HEAD");
  claudiaP = (await join("claudia", "CLIENTE")).id;
});

afterAll(async () => {
  await owner.event.update({ where: { id: ev }, data: { deletedAt: new Date() } });
  await Promise.all([db.$disconnect(), owner.$disconnect()]);
});

const byTitle = async (title: string) => (await getSchedule(await sofia(), ev, NOW)).milestones.find((m) => m.title === title)!;

describe("marcos", () => {
  it("o evento nasce com os marcos de T-30 a T0, contados da data dele", async () => {
    const s = await getSchedule(await sofia(), ev, NOW);
    expect(s.milestones.map((m) => [m.t, m.dueOn, m.title])).toEqual([
      ["T-30", "2027-11-10", "Orçamento fechado"],
      ["T-21", "2027-11-19", "Cotações concluídas"],
      ["T-15", "2027-11-25", "Contratos assinados"],
      ["T-10", "2027-11-30", "Visita técnica e planta final"],
      ["T-7", "2027-12-03", "Equipe fechada"],
      ["T-3", "2027-12-07", "Logística de montagem"],
      ["T-1", "2027-12-09", "Checklist final"],
      ["T0", "2027-12-10", "Dia do evento"],
    ]);
    expect(s).toMatchObject({ todayT: "T-20", late: 2, progress: { done: 0, total: 8, pct: 0 } });
    expect(s.milestones.map((m) => m.state).slice(0, 3)).toEqual(["ATRASADO", "ATRASADO", "PROXIMO"]);
  });

  it("a Pré-produção marca feito no próprio nome; o banco não aceita outro nome", async () => {
    const m = await byTitle("Orçamento fechado");
    await setMilestoneDone(await sofia(), m.id, { done: true });
    expect(await byTitle("Orçamento fechado")).toMatchObject({ state: "FEITO", doneBy: "Sofia Pré-produtora" });
    expect((await getSchedule(await sofia(), ev, NOW)).progress).toEqual({ done: 1, total: 8, pct: 13 });
    const other = await byTitle("Cotações concluídas");
    await expectPgError(as("sofia", (tx) => tx.eventMilestone.update({ where: { id: other.id }, data: { doneAt: new Date(), doneById: d.users.marina! } })), "42501");
    await setMilestoneDone(await marina(), m.id, { done: false });
    expect((await byTitle("Orçamento fechado")).state).toBe("ATRASADO");
  });

  it("cria, muda e apaga marco; responsável é alguém do evento, sem o cliente", async () => {
    const s = await sofia();
    await expectStatus(createMilestone(s, ev, { title: "Pedir alvará", dueOn: "2027-11-22", responsibleId: claudiaP }), 422);
    await expectStatus(createMilestone(s, ev, { title: " ", dueOn: "2027-11-22" }), 422);
    const { id } = await createMilestone(s, ev, { title: "Pedir alvará", dueOn: "2027-11-22", responsibleId: sofiaP });
    await updateMilestone(s, id, { dueOn: "2027-11-20", title: "Pedir alvará na prefeitura" });
    expect(await byTitle("Pedir alvará na prefeitura")).toMatchObject({ t: "T-20", state: "HOJE", responsible: "sofia" });
    await deleteMilestone(s, id);
    expect((await getSchedule(s, ev, NOW)).milestones).toHaveLength(8);
  });

  it("o botão de marcos padrão só cria quando o evento não tem nenhum", async () => {
    const m = await marina();
    expect(await createDefaultMilestones(m, ev)).toEqual({ created: 0 });
    await owner.eventMilestone.deleteMany({ where: { eventId: ev } });
    expect(await createDefaultMilestones(m, ev)).toEqual({ created: 8 });
  });

  it("o campo e o cliente não veem nem mexem (serviço e banco)", async () => {
    for (const p of ["rafael", "claudia", "joao"] as Person[]) await expectStatus(getSchedule(await actorFor(db, p), ev, NOW), 404);
    expect(await as("rafael", (tx) => tx.eventMilestone.count({ where: { eventId: ev } }))).toBe(0);
    await expectPgError(as("rafael", (tx) => tx.eventMilestone.create({ data: { eventId: ev, title: "x", dueOn: new Date("2027-11-30"), createdById: d.users.rafael! } })), "42501");
    await expectPgError(as("claudia", (tx) => tx.$queryRaw`SELECT app.create_default_milestones(${ev}::uuid)`), "42501");
  });
});

describe("itens com prazo e dependência", () => {
  let palco: string;
  let luz: string;

  it("o item depende de outro; o cronograma mostra que está esperando", async () => {
    const m = await marina();
    const section = await createCostSection(m, ev, { name: "Estrutura" });
    palco = (await createCostItem(m, section.id, { name: "Palco 12x8", quantity: 1 })).id;
    luz = (await createCostItem(m, section.id, { name: "Grid de luz", quantity: 1 })).id;
    await updateCostItem(await sofia(), palco, { neededOn: "2027-12-05" });
    await updateCostItem(await sofia(), luz, { neededOn: "2027-12-04", dependsOnId: palco });
    const s = await getSchedule(await sofia(), ev, NOW);
    expect(s.items.find((i) => i.id === luz)).toMatchObject({ t: "T-6", state: "PROXIMO", waiting: true, dependencyLate: true, dependsOn: { name: "Palco 12x8", ready: false } });
    await updateCostItem(m, palco, { status: "PRONTO" });
    expect((await getSchedule(await sofia(), ev, NOW)).items.find((i) => i.id === luz)).toMatchObject({ waiting: false });
  });

  it("sem círculo (serviço e banco) e sem depender de si mesmo", async () => {
    await expectStatus(updateCostItem(await sofia(), palco, { dependsOnId: luz }), 422);
    await expectStatus(updateCostItem(await sofia(), palco, { dependsOnId: palco }), 422);
    await expectPgError(as("marina", (tx) => tx.costItem.update({ where: { id: palco }, data: { dependsOnId: luz } })), "23514");
  });

  it("apagar o item solta quem dependia dele", async () => {
    await deleteCostItem(await marina(), palco);
    expect((await owner.costItem.findUniqueOrThrow({ where: { id: luz } })).dependsOnId).toBeNull();
  });
});
