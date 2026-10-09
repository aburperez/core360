import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectPgError, expectStatus, ownerDb, type Person } from "../helpers";
import { withUser, type Tx } from "@/server/db/with-user";
import { memoryStorage, setStorageForTests } from "@/server/storage/storage";
import { createEvent } from "@/modules/events/events.service";
import { createCostItem, createCostSection, updateCostItem } from "@/modules/costs/costs.service";
import { addSupplierQuote, chooseQuote, createQuote } from "@/modules/quotes/quotes.service";
import { attachContractPdf, createContract, setContractStatus } from "@/modules/contracts/contracts.service";
import { createArrival, deleteArrival, listArrivals, setArrivalStatus, updateArrival } from "@/modules/arrivals/arrivals.service";

/**
 * Mapa de montagem (fase 5A): o contrato assinado vira uma chegada com os
 * itens; a Pré-produção completa; no campo o Gerente vê todas, o Head as da
 * área dele e o Operacional as que são dele, e só marcam o status. Sem
 * valores. Pelo serviço e direto no banco.
 */

const db = appDb();
const owner = ownerDb();
const d = demo();
const as = <T>(p: Person, fn: (tx: Tx) => Promise<T>) => withUser(db, d.users[p]!, fn);
const sofia = () => actorFor(db, "sofia");
const marina = () => actorFor(db, "marina");
const rafael = () => actorFor(db, "rafael");

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
let infra: string;
let bar: string;
let pedroP: string;
let claudiaP: string;
let gerador: string;
let barArrival: string;

beforeAll(async () => {
  setStorageForTests(memoryStorage());
  const e = await createEvent(await actorFor(db, "admin"), { clientId: d.clients.rock.id, name: "Feira da montagem", startsAt: "2027-12-10T10:00", endsAt: "2027-12-12T22:00" });
  ev = e.id;
  infra = (await owner.area.create({ data: { eventId: ev, name: "Infra" } })).id;
  bar = (await owner.area.create({ data: { eventId: ev, name: "Bar" } })).id;
  const team = (await owner.team.create({ data: { eventId: ev, areaId: infra, name: "Energia" } })).id;
  const join = (p: Person, role: "GERENTE" | "PRE_PRODUTOR" | "HEAD" | "OPERACIONAL" | "CLIENTE", areaId?: string, teamId?: string) =>
    owner.participant.create({ data: { eventId: ev, userId: d.users[p]!, name: p, email: `${p}-mo@rockfestival.dev`, role, areaId, teamId, joinedAt: new Date() } });
  await join("marina", "GERENTE");
  await join("sofia", "PRE_PRODUTOR");
  await join("rafael", "HEAD", infra);
  await join("beatriz", "HEAD", bar);
  pedroP = (await join("pedro", "OPERACIONAL", infra, team)).id;
  claudiaP = (await join("claudia", "CLIENTE")).id;
});

afterAll(async () => {
  await owner.event.update({ where: { id: ev }, data: { deletedAt: new Date() } });
  await Promise.all([db.$disconnect(), owner.$disconnect()]);
});

const list = async (p: Person, now?: Date) => listArrivals(await actorFor(db, p), ev, now);

describe("o mapa nasce dos contratos", () => {
  it("contrato assinado vira chegada, com os itens (sem valores) e a área deles", async () => {
    const m = await marina();
    const section = await createCostSection(m, ev, { name: "Energia" });
    gerador = (await createCostItem(m, section.id, { name: "Gerador 300 kVA", quantity: 2, frequency: 1 })).id;
    await updateCostItem(m, gerador, { areaId: infra, unit: "UN" });
    const s = await sofia();
    const sP = (await owner.participant.findFirstOrThrow({ where: { eventId: ev, userId: d.users.sofia! } })).id;
    const q = await createQuote(s, ev, { title: "Gerador", briefing: "Gerador 300 kVA.", responsibleId: sP, costItemId: gerador });
    const doc = cnpj("517204330001");
    const win = await addSupplierQuote(s, q.id, { cnpj: doc, companyName: "Montagem Energia Ltda", contactName: "Bia", phone: "(41) 98765-1234", email: "bia@montagem.dev", totalValue: 9_000 });
    await chooseQuote(m, q.id, { quoteId: win.id });
    const supplier = (await owner.supplier.findFirstOrThrow({ where: { cnpj: doc } })).id;
    const c = await createContract(s, ev, { supplierId: supplier });
    expect((await list("sofia")).items).toEqual([]);
    await attachContractPdf(s, c.id, { bytes: new TextEncoder().encode("%PDF-1.4\n% contrato\n"), name: "contrato.pdf" });
    await setContractStatus(m, c.id, { action: "ASSINAR", signedOn: "2027-11-20" });
    const l = await list("sofia");
    expect(l.items).toHaveLength(1);
    expect(l.items[0]).toMatchObject({ supplierName: "Montagem Energia Ltda", area: "Infra", status: "AGENDADO", items: [{ name: "Gerador 300 kVA", quantity: 2, unit: "UN" }] });
    expect(JSON.stringify(l.items[0])).not.toContain("9000");
  });

  it("a Pré-produção completa: horário no fuso do evento, veículo, placa, doca e responsável do campo", async () => {
    const s = await sofia();
    const id = (await list("sofia")).items[0]!.id;
    await updateArrival(s, id, { scheduledAt: "2027-12-08T07:30", endsAt: "2027-12-08T12:00", vehicle: "Caminhão baú", plate: "abc1d23", dock: "Portão 3", responsibleId: pedroP });
    expect((await list("sofia")).items[0]).toMatchObject({ scheduledAt: new Date("2027-12-08T10:30:00Z"), plate: "ABC1D23", dock: "Portão 3", responsible: "pedro", day: "2027-12-08" });
    await expectStatus(updateArrival(s, id, { responsibleId: claudiaP }), 422);
    await expectStatus(updateArrival(s, id, { endsAt: "2027-12-08T06:00" }), 422);
    barArrival = (await createArrival(s, ev, { supplierName: "Chopp Gelado", scheduledAt: "2027-12-08T05:00", areaId: bar })).id;
  });
});

describe("quem vê e quem marca", () => {
  it("Gerente vê todas; Head só as da área; Operacional só as dele; o cliente não", async () => {
    expect((await list("marina")).items.map((a) => a.supplierName)).toEqual(["Chopp Gelado", "Montagem Energia Ltda"]);
    expect((await list("rafael")).items.map((a) => a.supplierName)).toEqual(["Montagem Energia Ltda"]);
    expect((await list("beatriz")).items.map((a) => a.supplierName)).toEqual(["Chopp Gelado"]);
    expect((await list("pedro")).items.map((a) => a.supplierName)).toEqual(["Montagem Energia Ltda"]);
    await expectStatus(list("claudia"), 404);
    expect(await as("claudia", (tx) => tx.arrival.count({ where: { eventId: ev } }))).toBe(0);
  });

  it("o campo marca chegou no próprio nome; quem passou do horário fica atrasado", async () => {
    const id = (await list("rafael")).items[0]!.id;
    await setArrivalStatus(await rafael(), id, { status: "CHEGOU" });
    const now = new Date("2027-12-08T11:00:00Z");
    const l = await list("marina", now);
    expect(l.items.find((a) => a.id === id)).toMatchObject({ status: "CHEGOU", arrivedBy: "Rafael Head Infra", late: null });
    expect(l.items.find((a) => a.id === barArrival)).toMatchObject({ status: "AGENDADO", late: "Não chegou no horário" });
    expect(l.totals).toMatchObject({ total: 2, arrived: 1, late: 1 });
    await setArrivalStatus(await rafael(), id, { status: "MONTANDO" });
    expect((await list("marina", new Date("2027-12-08T16:00:00Z"))).items.find((a) => a.id === id)?.late).toBe("Montagem atrasada");
    await setArrivalStatus(await rafael(), id, { status: "AGENDADO" });
    expect(await owner.arrival.findUniqueOrThrow({ where: { id } })).toMatchObject({ arrivedAt: null, arrivedById: null });
  });

  it("o campo não muda o resto, nem marca no nome de outro (serviço e banco)", async () => {
    const id = (await list("rafael")).items[0]!.id;
    await expectStatus(updateArrival(await rafael(), id, { dock: "Portão 9" }), 404);
    await expectPgError(as("rafael", (tx) => tx.arrival.update({ where: { id }, data: { dock: "Portão 9" } })), "42501");
    await expectPgError(as("rafael", (tx) => tx.arrival.update({ where: { id }, data: { status: "CHEGOU", arrivedAt: new Date(), arrivedById: d.users.marina! } })), "42501");
    await expectStatus(setArrivalStatus(await actorFor(db, "beatriz"), id, { status: "CHEGOU" }), 404);
    await expectPgError(as("rafael", (tx) => tx.arrival.create({ data: { eventId: ev, supplierName: "x", createdById: d.users.rafael! } })), "42501");
  });

  it("só a Pré-produção apaga", async () => {
    await expectStatus(deleteArrival(await rafael(), (await list("rafael")).items[0]!.id), 404);
    expect(await as("beatriz", (tx) => tx.arrival.deleteMany({ where: { id: barArrival } }))).toEqual({ count: 0 });
    await deleteArrival(await sofia(), barArrival);
    expect(await owner.arrival.count({ where: { id: barArrival } })).toBe(0);
  });
});
