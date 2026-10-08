import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectPgError, expectStatus, ownerDb, type Person } from "../helpers";
import { withUser, type Tx } from "@/server/db/with-user";
import { memoryStorage, setStorageForTests } from "@/server/storage/storage";
import { createEvent } from "@/modules/events/events.service";
import { createCostItem, createCostSection, updateCostItem } from "@/modules/costs/costs.service";
import { addSupplierQuote, chooseQuote, createQuote } from "@/modules/quotes/quotes.service";
import { attachContractPdf, createContract, setContractStatus } from "@/modules/contracts/contracts.service";
import { setMilestoneDone } from "@/modules/schedule/schedule.service";
import { createTask, deleteTask, listPendencies, pendenciesSummary, setTaskDone, updateTask } from "@/modules/pendencies/pendencies.service";

/**
 * Central de pendências (fase 4B): o app junta marcos, itens com prazo,
 * cotações, contratos, avaliações e as pendências manuais em Atrasado, Vence
 * hoje, Próximos 7 dias e Sem data, com filtro por área e responsável. Só a
 * Pré-produção vê. Pelo serviço e direto no banco.
 */

const db = appDb();
const owner = ownerDb();
const d = demo();
const as = <T>(p: Person, fn: (tx: Tx) => Promise<T>) => withUser(db, d.users[p]!, fn);
const sofia = () => actorFor(db, "sofia");
const marina = () => actorFor(db, "marina");
// 20/11/2027 ao meio-dia em São Paulo: T-20 de um evento que começa em 10/12.
const NOW = new Date("2027-11-20T15:00:00Z");

/** CNPJ válido (com os dígitos verificadores) a partir de 12 números. */
function cnpj(base: string) {
  const dv = (s: string) => {
    const w = s.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = [...s].reduce((t, c, i) => t + Number(c) * w[i]!, 0) % 11;
    return String(r < 2 ? 0 : 11 - r);
  };
  const a = base + dv(base);
  return a + dv(a);
}

let ev: string;
let palco: string;
let luz: string;
let sofiaP: string;
let rafaelP: string;
let claudiaP: string;

beforeAll(async () => {
  setStorageForTests(memoryStorage());
  const e = await createEvent(await actorFor(db, "admin"), { clientId: d.clients.rock.id, name: "Feira das pendências", startsAt: "2027-12-10T10:00", endsAt: "2027-12-12T22:00" });
  ev = e.id;
  palco = (await owner.area.create({ data: { eventId: ev, name: "Palco" } })).id;
  luz = (await owner.area.create({ data: { eventId: ev, name: "Luz" } })).id;
  const join = (p: Person, role: "GERENTE" | "PRE_PRODUTOR" | "HEAD" | "CLIENTE") =>
    owner.participant.create({ data: { eventId: ev, userId: d.users[p]!, name: p, email: `${p}-pe@rockfestival.dev`, role, areaId: role === "HEAD" ? palco : undefined, joinedAt: new Date() } });
  await join("marina", "GERENTE");
  sofiaP = (await join("sofia", "PRE_PRODUTOR")).id;
  rafaelP = (await join("rafael", "HEAD")).id;
  claudiaP = (await join("claudia", "CLIENTE")).id;
});

afterAll(async () => {
  await owner.event.update({ where: { id: ev }, data: { deletedAt: new Date() } });
  await Promise.all([db.$disconnect(), owner.$disconnect()]);
});

const list = async (p: "sofia" | "marina" = "sofia", filters = {}) => listPendencies(await actorFor(db, p), ev, filters, NOW);
const titles = (l: Awaited<ReturnType<typeof list>>, group: string) => l.items.filter((i) => i.group === group).map((i) => i.title);

describe("o que entra na central", () => {
  it("os marcos não feitos: T-30 e T-21 atrasados, T-15 na semana, o resto depois", async () => {
    const l = await list();
    expect(titles(l, "ATRASADO")).toEqual(["Orçamento fechado", "Cotações concluídas"]);
    expect(l.items.find((i) => i.title === "Orçamento fechado")).toMatchObject({ kind: "MARCO", lateDays: 10, toggle: true });
    expect(titles(l, "SEMANA")).toEqual(["Contratos assinados"]);
    expect(l.totals).toEqual({ late: 2, today: 0, week: 1, undated: 0, later: 5 });
    const m = l.items.find((i) => i.title === "Orçamento fechado")!;
    await setMilestoneDone(await sofia(), m.id, { done: true });
    expect((await pendenciesSummary(await sofia(), ev, NOW)).late).toBe(1);
  });

  it("item com prazo entra até ficar Pronto, com área e responsável", async () => {
    const m = await marina();
    const section = await createCostSection(m, ev, { name: "Estrutura" });
    const item = (await createCostItem(m, section.id, { name: "Palco 12x8", quantity: 1 })).id;
    await updateCostItem(await sofia(), item, { neededOn: "2027-11-20", areaId: palco, responsibleId: rafaelP });
    let p = (await list()).items.find((i) => i.id === item);
    expect(p).toMatchObject({ kind: "ITEM", group: "HOJE", title: "Palco 12x8 pronto", area: { name: "Palco" }, responsible: { id: rafaelP } });
    await updateCostItem(m, item, { status: "PRONTO" });
    p = (await list()).items.find((i) => i.id === item);
    expect(p).toBeUndefined();
  });

  it("cotação esperando os fornecedores: atrasa quando passa a hora do prazo", async () => {
    const q = await createQuote(await sofia(), ev, { title: "Gerador", briefing: "Gerador 300 kVA, 2 diárias.", responsibleId: sofiaP });
    expect((await list()).items.find((i) => i.id === q.id)).toMatchObject({ kind: "COTACAO", group: "SEM_DATA", title: 'Enviar a cotação "Gerador"' });
    // Enviada às 10h de hoje com prazo até as 11h: às 12h já está atrasada.
    await owner.quoteRequest.update({ where: { id: q.id }, data: { status: "ENVIADA", sentAt: new Date("2027-11-20T13:00:00Z"), slaMinutes: 60, dueAt: new Date("2027-11-20T14:00:00Z") } });
    expect((await list()).items.find((i) => i.id === q.id)).toMatchObject({ group: "ATRASADO", title: 'Receber os orçamentos de "Gerador"', detail: "0 de 3 recebidos" });
    await owner.quoteRequest.update({ where: { id: q.id }, data: { status: "CANCELADA" } });
  });

  it("contrato não assinado; no Fechamento, a avaliação aparece só para o diretor", async () => {
    const m = await marina();
    const section = await createCostSection(m, ev, { name: "Energia" });
    const item = (await createCostItem(m, section.id, { name: "Gerador 300 kVA", quantity: 1, frequency: 1 })).id;
    await updateCostItem(m, item, { neededOn: "2027-11-24" });
    const q = await createQuote(await sofia(), ev, { title: "Gerador do palco", briefing: "Gerador 300 kVA.", responsibleId: sofiaP, costItemId: item });
    const doc = cnpj("438102770001");
    const win = await addSupplierQuote(await sofia(), q.id, { cnpj: doc, companyName: "Pendente Energia Ltda", contactName: "Bia", phone: "(41) 98765-1234", email: "bia@pendente.dev", totalValue: 9_000 });
    await chooseQuote(m, q.id, { quoteId: win.id });
    const supplier = (await owner.supplier.findFirstOrThrow({ where: { cnpj: doc } })).id;
    const c = await createContract(await sofia(), ev, { supplierId: supplier });
    expect((await list()).items.find((i) => i.id === c.id)).toMatchObject({ kind: "CONTRATO", group: "SEMANA", dueOn: "2027-11-24", title: "Enviar o contrato nº 1 (Pendente Energia Ltda)" });
    await attachContractPdf(await sofia(), c.id, { bytes: new TextEncoder().encode("%PDF-1.4\n% contrato\n"), name: "contrato.pdf" });
    await setContractStatus(m, c.id, { action: "ASSINAR", signedOn: "2027-11-19" });
    expect((await list()).items.some((i) => i.kind === "CONTRATO")).toBe(false);

    await owner.event.update({ where: { id: ev }, data: { status: "FECHAMENTO" } });
    expect((await list("marina")).items.find((i) => i.kind === "AVALIACAO")).toMatchObject({ title: "Avaliar Pendente Energia Ltda", group: "SEM_DATA" });
    expect((await list("sofia")).items.some((i) => i.kind === "AVALIACAO")).toBe(false);
    await owner.event.update({ where: { id: ev }, data: { status: "PRE_PRODUCAO" } });
  });
});

describe("pendências manuais e filtros", () => {
  let task: string;

  it("cria com prazo, área e responsável; filtra por área e por responsável", async () => {
    const s = await sofia();
    task = (await createTask(s, ev, { title: "Pedir o alvará dos bombeiros", dueOn: "2027-11-22", areaId: luz, responsibleId: sofiaP })).id;
    await createTask(s, ev, { title: "Conferir as credenciais" });
    const all = await list();
    expect(all.items.find((i) => i.id === task)).toMatchObject({ kind: "MANUAL", group: "SEMANA", area: { name: "Luz" }, toggle: true });
    expect(titles(all, "SEM_DATA")).toContain("Conferir as credenciais");
    expect((await list("sofia", { areaId: luz })).items.map((i) => i.title)).toEqual(["Pedir o alvará dos bombeiros"]);
    expect((await list("sofia", { responsibleId: sofiaP })).items.map((i) => i.title)).toEqual(["Pedir o alvará dos bombeiros"]);
    // Filtro mexido no endereço vale como sem filtro.
    expect((await list("sofia", { areaId: "x" })).items.length).toBe(all.items.length);
  });

  it("muda, marca feita (no próprio nome) e apaga", async () => {
    await updateTask(await marina(), task, { dueOn: "2027-11-19", title: "Alvará dos bombeiros" });
    expect((await list()).items.find((i) => i.id === task)).toMatchObject({ group: "ATRASADO", title: "Alvará dos bombeiros", lateDays: 1 });
    await expectPgError(as("sofia", (tx) => tx.eventTask.update({ where: { id: task }, data: { doneAt: new Date(), doneById: d.users.marina! } })), "42501");
    await setTaskDone(await sofia(), task, { done: true });
    expect((await list()).items.some((i) => i.id === task)).toBe(false);
    expect(await owner.eventTask.findUniqueOrThrow({ where: { id: task } })).toMatchObject({ doneById: d.users.sofia });
    await deleteTask(await sofia(), task);
    expect(await owner.eventTask.count({ where: { id: task } })).toBe(0);
  });

  it("responsável e área têm que ser do evento (sem o cliente)", async () => {
    const s = await sofia();
    await expectStatus(createTask(s, ev, { title: "x", responsibleId: claudiaP }), 422);
    const other = await owner.area.findFirstOrThrow({ where: { eventId: { not: ev } } });
    await expectStatus(createTask(s, ev, { title: "x", areaId: other.id }), 422);
    await expectStatus(createTask(s, ev, { title: "  " }), 422);
  });

  it("o campo e o cliente não veem nem mexem (serviço e banco)", async () => {
    for (const p of ["rafael", "claudia", "joao"] as Person[]) await expectStatus(listPendencies(await actorFor(db, p), ev, {}, NOW), 404);
    expect(await as("rafael", (tx) => tx.eventTask.count({ where: { eventId: ev } }))).toBe(0);
    await expectPgError(as("rafael", (tx) => tx.eventTask.create({ data: { eventId: ev, title: "x", createdById: d.users.rafael! } })), "42501");
    await expectPgError(as("sofia", (tx) => tx.eventTask.create({ data: { eventId: ev, title: "x", createdById: d.users.marina! } })), "42501");
  });
});
