import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectPgError, expectStatus, ownerDb, type Person } from "../helpers";
import { withUser, type Tx } from "@/server/db/with-user";
import { memoryStorage, setStorageForTests } from "@/server/storage/storage";
import { createEvent } from "@/modules/events/events.service";
import { createCostItem, createCostSection } from "@/modules/costs/costs.service";
import { addSupplierQuote, chooseQuote, createQuote, getQuote } from "@/modules/quotes/quotes.service";
import { attachContractPdf, createContract, setContractStatus } from "@/modules/contracts/contracts.service";
import { getSupplier, listSuppliers } from "@/modules/suppliers/suppliers.service";
import { listEventRatings, myRatings, rateSupplier } from "@/modules/suppliers/ratings.service";

/**
 * Avaliação dos fornecedores (fase 3D): com o evento no Fechamento, só o
 * diretor dá de 0 a 10 em 6 critérios para quem teve contrato assinado. A
 * Pré-produção vê só a média (no cadastro e na cotação); as notas de cada
 * evento e o comentário ficam com o diretor. Pelo serviço e direto no banco.
 */

const db = appDb();
const owner = ownerDb();
const d = demo();
const as = <T>(p: Person, fn: (tx: Tx) => Promise<T>) => withUser(db, d.users[p]!, fn);
const sofia = () => actorFor(db, "sofia");
const marina = () => actorFor(db, "marina");

const CNPJ = { forte: "62.096.654/0001-18", fraco: "28.707.229/0001-80" };
const proposal = (cnpj: string, name: string, totalValue: number) => ({
  cnpj, companyName: name, contactName: "Bia", phone: "(41) 98765-1234", email: `bia@${name.split(" ")[0]!.toLowerCase()}.dev`, totalValue,
});
const GOOD = { quality: 9, deadline: 8, service: 10, cost: 7, flexibility: 9, problemSolving: 8, comment: "Gerador chegou antes e o técnico ficou o evento todo." };
const scores = { quality: 9, deadline: 8, service: 10, cost: 7, flexibility: 9, problemSolving: 8 };

let ev: string;
let forte: string;
let fraco: string;
let request: string;
let item: string;
let area: string;

beforeAll(async () => {
  setStorageForTests(memoryStorage());
  const e = await createEvent(await actorFor(db, "admin"), { clientId: d.clients.rock.id, name: "Feira das avaliações", startsAt: "2027-11-01T10:00", endsAt: "2027-11-02T22:00" });
  ev = e.id;
  area = (await owner.area.create({ data: { eventId: ev, name: "Infra" } })).id;
  const join = (p: Person, role: "GERENTE" | "PRE_PRODUTOR" | "HEAD") =>
    owner.participant.create({ data: { eventId: ev, userId: d.users[p]!, name: p, email: `${p}-av@rockfestival.dev`, role, areaId: role === "HEAD" ? area : undefined, joinedAt: new Date() } });
  await join("marina", "GERENTE");
  const s = await join("sofia", "PRE_PRODUTOR");
  await join("rafael", "HEAD");

  const m = await marina();
  const section = await createCostSection(m, ev, { name: "Energia" });
  item = (await createCostItem(m, section.id, { name: "Gerador 300 kVA", quantity: 1, frequency: 1 })).id;
  request = (await createQuote(await sofia(), ev, { title: "Gerador", briefing: "Gerador 300 kVA, 2 diárias.", responsibleId: s.id, costItemId: item })).id;
  const win = await addSupplierQuote(await sofia(), request, proposal(CNPJ.forte, "Forte Geradores Ltda", 20_000));
  await addSupplierQuote(await sofia(), request, proposal(CNPJ.fraco, "Fraco Energia Ltda", 22_000));
  await chooseQuote(m, request, { quoteId: win.id });
  forte = (await owner.supplier.findFirstOrThrow({ where: { cnpj: CNPJ.forte.replace(/\D/g, "") } })).id;
  fraco = (await owner.supplier.findFirstOrThrow({ where: { cnpj: CNPJ.fraco.replace(/\D/g, "") } })).id;
  const c = await createContract(await sofia(), ev, { supplierId: forte });
  await attachContractPdf(await sofia(), c.id, { bytes: new TextEncoder().encode("%PDF-1.4\n% contrato\n"), name: "contrato.pdf" });
  await setContractStatus(m, c.id, { action: "ASSINAR", signedOn: "2027-10-20" });
});

afterAll(async () => {
  await owner.event.update({ where: { id: ev }, data: { deletedAt: new Date() } });
  await Promise.all([db.$disconnect(), owner.$disconnect()]);
});

const insert = (p: Person, supplierId: string, extra: Partial<typeof scores> = {}) =>
  as(p, (tx) => tx.supplierRating.create({ data: { eventId: ev, supplierId, ...scores, ...extra, ratedById: d.users[p]! } }));

describe("quando e quem avalia", () => {
  it("antes do Fechamento a avaliação fica fechada (serviço e banco)", async () => {
    const l = await listEventRatings(await marina(), ev);
    expect(l).toMatchObject({ open: false, done: 0 });
    expect(l.items.map((i) => i.name)).toEqual(["Forte Geradores Ltda"]);
    await expectStatus(rateSupplier(await marina(), ev, forte, GOOD), 422);
    await expectPgError(insert("marina", forte), "23514");
  });

  it("no Fechamento, só o diretor avalia; o pré-produtor e o campo não", async () => {
    await owner.event.update({ where: { id: ev }, data: { status: "FECHAMENTO" } });
    await expectStatus(listEventRatings(await sofia(), ev), 403);
    await expectStatus(rateSupplier(await sofia(), ev, forte, GOOD), 403);
    await expectPgError(insert("sofia", forte), "42501");
    await expectStatus(listEventRatings(await actorFor(db, "rafael"), ev), 404);
  });

  it("só fornecedor com contrato assinado; nota de 0 a 10 (serviço e banco)", async () => {
    const m = await marina();
    await expectStatus(rateSupplier(m, ev, fraco, GOOD), 422);
    await expectPgError(insert("marina", fraco), "23514");
    await expectStatus(rateSupplier(m, ev, forte, { ...GOOD, cost: 11 }), 422);
    await expectStatus(rateSupplier(m, ev, forte, { ...GOOD, deadline: "" }), 422);
    await expectPgError(insert("marina", forte, { cost: 11 }), "23514");
  });
});

describe("nota e média", () => {
  it("o diretor avalia e corrige; fica uma nota por fornecedor no evento", async () => {
    const m = await marina();
    expect(await rateSupplier(m, ev, forte, GOOD)).toMatchObject({ average: 8.5, comment: GOOD.comment });
    expect(await rateSupplier(m, ev, forte, { ...GOOD, cost: 10 })).toMatchObject({ cost: 10, average: 9 });
    expect(await owner.supplierRating.count({ where: { eventId: ev } })).toBe(1);
    const l = await listEventRatings(m, ev);
    expect(l).toMatchObject({ open: true, done: 1 });
    expect(l.items[0]).toMatchObject({ total: 20_000, contracts: [1], rating: { average: 9, ratedBy: "Marina Gerente" }, history: { ratings: 1, overall: 9 } });
  });

  it("o pré-produtor vê a média no cadastro e na cotação, sem as notas de cada evento", async () => {
    const s = await sofia();
    expect((await listSuppliers(s, ev)).items.find((x) => x.id === forte)?.rating).toMatchObject({ ratings: 1, overall: 9, cost: 10 });
    const ficha = await getSupplier(s, ev, forte);
    expect(ficha.rating).toMatchObject({ overall: 9 });
    expect(ficha.ratings).toEqual([]);
    expect(await as("sofia", (tx) => tx.supplierRating.count({ where: { supplierId: forte } }))).toBe(0);
    expect((await getQuote(s, request)).quotes.map((q) => q.rating)).toEqual([9, null]);
  });

  it("o diretor vê as notas de cada evento com o comentário", async () => {
    const ficha = await getSupplier(await marina(), ev, forte);
    expect(ficha.ratings).toEqual([expect.objectContaining({ eventId: ev, cost: 10, comment: GOOD.comment, ratedBy: "Marina Gerente" })]);
  });

  it("o campo não vê nem a média", async () => {
    const rows = await as("rafael", (tx) => tx.$queryRaw<unknown[]>`SELECT * FROM app.supplier_rating_summary(${d.agency.id}::uuid)`);
    expect(rows).toEqual([]);
    expect(await as("rafael", (tx) => tx.supplierRating.count({ where: { supplierId: forte } }))).toBe(0);
  });

  it("evento, fornecedor e autor não mudam (banco)", async () => {
    const r = await owner.supplierRating.findFirstOrThrow({ where: { eventId: ev } });
    await expectPgError(as("marina", (tx) => tx.supplierRating.update({ where: { id: r.id }, data: { supplierId: fraco } })), "23514");
    await expectPgError(as("marina", (tx) => tx.supplierRating.update({ where: { id: r.id }, data: { ratedById: d.users.sofia! } })), "42501");
  });
});

describe("o Head da área também avalia (pedido do Abu)", () => {
  const rafael = () => actorFor(db, "rafael");
  const HEAD = { quality: 7, deadline: 6, service: 8, cost: 7, flexibility: 6, problemSolving: 8, comment: "Atrasou a entrega do segundo gerador." };

  it("só quando o fornecedor tem item da área dele (serviço e banco)", async () => {
    await expectStatus(rateSupplier(await rafael(), ev, forte, HEAD), 403);
    await expectPgError(insert("rafael", forte), "42501");
    expect((await myRatings(await rafael(), ev)).canRate.size).toBe(0);
    await owner.costItem.update({ where: { id: item }, data: { areaId: area } });
    expect([...(await myRatings(await rafael(), ev)).canRate]).toEqual([forte]);
  });

  it("cada um dá a sua nota; a do evento é a média de todos", async () => {
    expect(await rateSupplier(await rafael(), ev, forte, HEAD)).toMatchObject({ average: 7 });
    expect(await owner.supplierRating.count({ where: { eventId: ev, supplierId: forte } })).toBe(2);
    const l = await listEventRatings(await marina(), ev);
    expect(l.items[0]).toMatchObject({ rating: { average: 9 }, others: [{ ratedBy: "Rafael Head Infra", average: 7, comment: HEAD.comment }], eventAverage: 8, history: { ratings: 1, overall: 8 } });
    expect((await myRatings(await rafael(), ev)).mine.get(forte)).toMatchObject({ average: 7 });
  });

  it("o Head vê e corrige só a nota dele, sem valores", async () => {
    expect(await as("rafael", (tx) => tx.supplierRating.findMany({ where: { eventId: ev }, select: { ratedById: true } }))).toEqual([{ ratedById: d.users.rafael }]);
    const marinas = await owner.supplierRating.findFirstOrThrow({ where: { eventId: ev, ratedById: d.users.marina! } });
    expect(await as("rafael", (tx) => tx.supplierRating.updateMany({ where: { id: marinas.id }, data: { cost: 0 } }))).toEqual({ count: 0 });
    await expectStatus(listEventRatings(await rafael(), ev), 404);
    await expectStatus(rateSupplier(await rafael(), ev, fraco, HEAD), 422);
  });
});
