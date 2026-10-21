import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectPgError, expectStatus, grantAllSections, ownerDb, type Person } from "../helpers";
import { withUser, type Tx } from "@/server/db/with-user";
import { productionArea } from "@/server/authz/policy";
import { createEvent } from "@/modules/events/events.service";
import { updateParticipant } from "@/modules/participants/participants.service";
import { createProducerAreas } from "@/modules/areas/areas.service";
import { createCostItem, createCostSection, getCostSheet, importCostSheet, updateCostItem } from "@/modules/costs/costs.service";
import { distributeItemsByArea, listItemMap, suggestArea } from "@/modules/items/items.service";
import { getBudget } from "@/modules/items/budget.service";
import { createQuote, listQuotes } from "@/modules/quotes/quotes.service";
import { listContracts } from "@/modules/contracts/contracts.service";
import { createArrival, listArrivals } from "@/modules/arrivals/arrivals.service";
import { createTask, listPendencies } from "@/modules/pendencies/pendencies.service";
import { getSchedule } from "@/modules/schedule/schedule.service";

/**
 * Pré-produção separada por área (Abu, 2026-10-21): o Pré-produtor ligado a
 * uma área vê e grava só os itens e as cotações dela, e as chegadas e
 * pendências dela ou do evento todo. Sem área, vê tudo. Pelo serviço e no banco.
 */

const db = appDb();
const owner = ownerDb();
const d = demo();
const as = <T>(p: Person, fn: (tx: Tx) => Promise<T>) => withUser(db, d.users[p]!, fn);
const text = (v: unknown) => JSON.stringify(v);

let ev: string;
let infra: string;
let ceno: string;
let sofiaP: string;
let marinaP: string;
let section: string;
let palco: string;
let cenario: string;
let taxa: string;

beforeAll(async () => {
  ev = (await createEvent(await actorFor(db, "admin"), { clientId: d.clients.rock.id, name: "Feira por área", startsAt: "2027-12-28T10:00", endsAt: "2027-12-30T22:00" })).id;
  const join = (p: Person, role: "GERENTE" | "PRE_PRODUTOR" | "HEAD", areaId?: string) =>
    owner.participant.create({ data: { eventId: ev, userId: d.users[p]!, name: p, email: `${p}-pa@rockfestival.dev`, role, areaId, joinedAt: new Date() } });
  marinaP = (await join("marina", "GERENTE")).id;
  sofiaP = (await join("sofia", "PRE_PRODUTOR")).id;
  await grantAllSections(owner, ev);
  const m = await actorFor(db, "marina");
  section = (await createCostSection(m, ev, { name: "Tudo" })).id;
  palco = (await createCostItem(m, section, { name: "Palco 12x8", quantity: 1, frequency: 1, unitValue: 50_000 })).id;
  cenario = (await createCostItem(m, section, { name: "Cenário principal", quantity: 1, frequency: 1, unitValue: 30_000 })).id;
  taxa = (await createCostItem(m, section, { name: "Taxa da prefeitura", quantity: 1, frequency: 1, unitValue: 2_000 })).id;
  await updateCostItem(m, palco, { category: "INFRAESTRUTURA" });
  await updateCostItem(m, cenario, { category: "CENOGRAFIA" });
  await updateCostItem(m, taxa, { category: "TAXAS" });
});

afterAll(async () => {
  await owner.event.update({ where: { id: ev }, data: { deletedAt: new Date() } });
  await Promise.all([db.$disconnect(), owner.$disconnect()]);
});

describe("áreas da lista de produtores", () => {
  it("o Gerente cria as áreas da lista de Produtores e Funções, mais Cenografia, sem repetir", async () => {
    await expectStatus(createProducerAreas(await actorFor(db, "sofia"), ev), 403);
    const m = await actorFor(db, "marina");
    const { created } = await createProducerAreas(m, ev);
    expect(created).toEqual(expect.arrayContaining(["A&B", "Infra", "Técnica", "Operação", "Cenografia"]));
    expect(created).toHaveLength(19);
    expect((await createProducerAreas(m, ev)).created).toEqual([]);
    const areas = await owner.area.findMany({ where: { eventId: ev }, select: { id: true, name: true } });
    infra = areas.find((a) => a.name === "Infra")!.id;
    ceno = areas.find((a) => a.name === "Cenografia")!.id;
  });

  it("sugere a área pela categoria", () => {
    const areas = [{ id: "i", name: "Infra" }, { id: "c", name: "Cenografia" }, { id: "t", name: "Técnica" }, { id: "a", name: "A&B" }];
    expect(suggestArea("INFRAESTRUTURA", areas)).toBe("i");
    expect(suggestArea("MOBILIARIO", areas)).toBe("c");
    expect(suggestArea("COMUNICACAO_VISUAL", areas)).toBe("c");
    expect(suggestArea("ILUMINACAO", areas)).toBe("t");
    expect(suggestArea("ALIMENTACAO", areas)).toBe("a");
    expect(suggestArea("TAXAS", areas)).toBeNull();
    expect(suggestArea(null, areas)).toBeNull();
  });

  it("só o gestor distribui os itens; os sem área parecida ficam do evento todo", async () => {
    await expectStatus(distributeItemsByArea(await actorFor(db, "sofia"), ev), 403);
    expect(await distributeItemsByArea(await actorFor(db, "marina"), ev)).toEqual({ assigned: 2, left: 1 });
    const items = await owner.costItem.findMany({ where: { eventId: ev }, select: { id: true, areaId: true } });
    expect(Object.fromEntries(items.map((i) => [i.id, i.areaId]))).toEqual({ [palco]: infra, [cenario]: ceno, [taxa]: null });
  });
});

describe("pré-produtora de Cenografia", () => {
  beforeAll(async () => {
    const m = await actorFor(db, "marina");
    await createQuote(m, ev, { title: "Cotar palco", briefing: "12x8", responsibleId: marinaP, costItemId: palco });
    await createQuote(m, ev, { title: "Cotar cenário", briefing: "Cenário", responsibleId: marinaP, costItemId: cenario });
    await createQuote(m, ev, { title: "Cotar brindes", briefing: "Sem item", responsibleId: marinaP });
    await createTask(m, ev, { title: "Alvará da estrutura", areaId: infra });
    await createTask(m, ev, { title: "Pintar o cenário", areaId: ceno });
    await createTask(m, ev, { title: "Reunião geral" });
    await createArrival(m, ev, { supplierName: "Estruturas Sul", areaId: infra });
    await createArrival(m, ev, { supplierName: "Cenarte", areaId: ceno });
    await createArrival(m, ev, { supplierName: "Correios" });
    await updateParticipant(m, sofiaP, { areaId: ceno });
  });

  it("vê só a área dela: itens e cotações da área; chegadas e pendências da área ou do evento todo", async () => {
    const s = await actorFor(db, "sofia");
    expect(productionArea(s, ev)).toBe(ceno);
    const map = await listItemMap(s, ev);
    expect(map.items.map((i) => i.id)).toEqual([cenario]);
    const sheet = text(await getCostSheet(s, ev));
    expect(sheet).toContain("Cenário principal");
    expect(sheet).not.toContain("Palco 12x8");
    expect(sheet).not.toContain("Taxa da prefeitura");
    expect(text(await getBudget(s, ev))).not.toContain("Palco 12x8");

    const quotes = text(await listQuotes(s, ev));
    expect(quotes).toContain("Cotar cenário");
    expect(quotes).not.toContain("Cotar palco");
    expect(quotes).not.toContain("Cotar brindes");
    await listContracts(s, ev);

    const tasks = text(await listPendencies(s, ev));
    expect(tasks).toContain("Pintar o cenário");
    expect(tasks).toContain("Reunião geral");
    expect(tasks).not.toContain("Alvará da estrutura");
    const arrivals = text(await listArrivals(s, ev));
    expect(arrivals).toContain("Cenarte");
    expect(arrivals).toContain("Correios");
    expect(arrivals).not.toContain("Estruturas Sul");
    await getSchedule(s, ev);

    expect(await as("sofia", (tx) => tx.costItem.count({ where: { eventId: ev } }))).toBe(1);
    expect(await as("sofia", (tx) => tx.quoteRequest.count({ where: { eventId: ev } }))).toBe(1);
  });

  it("grava só na área dela", async () => {
    const s = await actorFor(db, "sofia");
    const novo = await createCostItem(s, section, { name: "Tapete do camarim", quantity: 1, frequency: 1, unitValue: 500 });
    expect((await owner.costItem.findUnique({ where: { id: novo.id } }))!.areaId).toBe(ceno);
    await expectStatus(updateCostItem(s, cenario, { areaId: infra }), 422);
    await expectStatus(updateCostItem(s, palco, { notes: "x" }), 404);
    await expectStatus(createQuote(s, ev, { title: "Sem item", briefing: "x", responsibleId: sofiaP }), 422);
    await expectStatus(createQuote(s, ev, { title: "Palco", briefing: "x", responsibleId: sofiaP, costItemId: palco }), 422);
    await createQuote(s, ev, { title: "Tapete", briefing: "x", responsibleId: sofiaP, costItemId: novo.id });
    await expectStatus(createTask(s, ev, { title: "Na infra", areaId: infra }), 422);
    const t = await createTask(s, ev, { title: "Do cenário" });
    expect((await owner.eventTask.findUnique({ where: { id: t.id } }))!.areaId).toBe(ceno);
    await expectStatus(createArrival(s, ev, { supplierName: "Outro", areaId: infra }), 422);
    await expectStatus(importCostSheet(s, ev, new Uint8Array(), { confirm: false }), 403);
  });

  it("no banco também: não lê nem move itens de outra área", async () => {
    await expectPgError(
      as("sofia", (tx) => tx.costItem.update({ where: { id: cenario }, data: { areaId: infra } })),
      "42501",
    );
    expect((await as("sofia", (tx) => tx.costItem.updateMany({ where: { id: palco }, data: { notes: "x" } }))).count).toBe(0);
    expect((await as("sofia", (tx) => tx.eventTask.updateMany({ where: { eventId: ev, areaId: infra }, data: { title: "x" } }))).count).toBe(0);
    await expectPgError(
      as("sofia", (tx) => tx.eventTask.create({ data: { eventId: ev, title: "x", areaId: infra, createdById: d.users.sofia! } })),
      "42501",
    );
  });

  it("o Gerente continua vendo tudo; sem área, a pré-produtora volta a ver o evento todo", async () => {
    expect((await listItemMap(await actorFor(db, "marina"), ev)).items.length).toBe(4);
    await updateParticipant(await actorFor(db, "marina"), sofiaP, { areaId: null });
    const s = await actorFor(db, "sofia");
    expect(productionArea(s, ev)).toBeNull();
    expect((await listItemMap(s, ev)).items.length).toBe(4);
  });

  it("app.production_area bate com a política", async () => {
    await updateParticipant(await actorFor(db, "marina"), sofiaP, { areaId: ceno });
    for (const p of ["admin", "marina", "sofia", "rafael", "paulo"] as const) {
      const a = await actorFor(db, p);
      const [row] = await as(p, (tx) => tx.$queryRaw<{ v: string | null }[]>`SELECT app.production_area(${ev}::uuid) AS v`);
      expect([p, row.v]).toEqual([p, productionArea(a, ev)]);
    }
  });
});
