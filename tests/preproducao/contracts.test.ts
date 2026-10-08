import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectPgError, expectStatus, ownerDb, type Person } from "../helpers";
import { withUser, type Tx } from "@/server/db/with-user";
import { memoryStorage, setStorageForTests } from "@/server/storage/storage";
import { createEvent } from "@/modules/events/events.service";
import { createCostItem, createCostSection } from "@/modules/costs/costs.service";
import { deleteDocument, listDocuments, listFieldDocuments, updateDocument } from "@/modules/documents/documents.service";
import { addSupplierQuote, chooseQuote, createQuote, negotiateProposal, setQuoteState } from "@/modules/quotes/quotes.service";
import {
  addContractItem,
  attachContractPdf,
  createContract,
  getContract,
  listContracts,
  removeContractItem,
  setContractItemValue,
  setContractStatus,
  updateContract,
} from "@/modules/contracts/contracts.service";

/**
 * Contratos (fase 3C, parte 2): um por fornecedor por evento, com as propostas
 * aprovadas dele. O pré-produtor monta, anexa o PDF e envia; só o diretor muda
 * valor, assina ou cancela. O PDF fica em Documentos (CONTRATO) e não vai para
 * o campo. Assinar leva o valor para o Contratado do Orçamento. O campo e o
 * cliente não veem nada. Pelo serviço e direto no banco.
 */

const db = appDb();
const owner = ownerDb();
const d = demo();
const as = <T>(p: Person, fn: (tx: Tx) => Promise<T>) => withUser(db, d.users[p]!, fn);
const sofia = () => actorFor(db, "sofia");
const marina = () => actorFor(db, "marina");
const PDF = (tag: string) => ({ bytes: new TextEncoder().encode(`%PDF-1.4\n% contrato ${tag}\n`), name: `contrato-${tag}.pdf` });

const CNPJ = { energia: "51.820.674/0001-73", som: "62.731.985/0001-82", luz: "73.642.096/0001-65" };
const proposal = (cnpj: string, name: string, totalValue: number) => ({
  cnpj, companyName: name, contactName: "Ana", phone: "(31) 98765-4321", email: `ana@${name.split(" ")[0]!.toLowerCase()}.dev`, totalValue, paymentTerms: "30 dias",
});

let ev: string;
let gerador: string;
let cabos: string;
let energia: string;
let som: string;
let contract: string;
let firstQuote: string;

beforeAll(async () => {
  setStorageForTests(memoryStorage());
  const e = await createEvent(await actorFor(db, "admin"), { clientId: d.clients.rock.id, name: "Feira dos contratos", startsAt: "2027-09-01T10:00", endsAt: "2027-09-02T22:00" });
  ev = e.id;
  const area = (await owner.area.create({ data: { eventId: ev, name: "Infra" } })).id;
  const join = (p: Person, role: "GERENTE" | "PRE_PRODUTOR" | "HEAD" | "CLIENTE") =>
    owner.participant.create({ data: { eventId: ev, userId: d.users[p]!, name: p, email: `${p}-ct@rockfestival.dev`, role, areaId: role === "HEAD" ? area : undefined, joinedAt: new Date() } });
  await join("marina", "GERENTE");
  const s = await join("sofia", "PRE_PRODUTOR");
  await join("rafael", "HEAD");
  await join("claudia", "CLIENTE");

  const m = await marina();
  const section = await createCostSection(m, ev, { name: "Energia" });
  gerador = (await createCostItem(m, section.id, { name: "Gerador 500 kVA", quantity: 1, frequency: 1 })).id;
  cabos = (await createCostItem(m, section.id, { name: "Cabos e QGBT", quantity: 1, frequency: 1 })).id;
  const somItem = (await createCostItem(m, section.id, { name: "PA principal", quantity: 1, frequency: 1 })).id;

  // Duas cotações ganhas pela mesma empresa (uma com valor negociado) e uma por outra.
  const cot = async (title: string, item: string, quotes: ReturnType<typeof proposal>[], win: number, negotiate?: number) => {
    const r = await createQuote(await sofia(), ev, { title, briefing: `${title}, 2 diárias.`, responsibleId: s.id, costItemId: item });
    const ids = [];
    for (const q of quotes) ids.push((await addSupplierQuote(await sofia(), r.id, q)).id);
    if (negotiate) await negotiateProposal(m, ids[win]!, { value: negotiate });
    await chooseQuote(m, r.id, { quoteId: ids[win], reason: "Melhor proposta" });
    return { request: r.id, chosen: ids[win]! };
  };
  const g = await cot("Gerador", gerador, [proposal(CNPJ.energia, "Energia Forte Ltda", 30_000), proposal(CNPJ.luz, "Luz Norte Ltda", 31_000)], 0, 28_500);
  firstQuote = g.chosen;
  await cot("Cabos", cabos, [proposal(CNPJ.energia, "Energia Forte Ltda", 4_000)], 0);
  await cot("Som", somItem, [proposal(CNPJ.som, "Som Total Ltda", 12_000)], 0);
  energia = (await owner.supplier.findFirstOrThrow({ where: { cnpj: CNPJ.energia.replace(/\D/g, "") } })).id;
  som = (await owner.supplier.findFirstOrThrow({ where: { cnpj: CNPJ.som.replace(/\D/g, "") } })).id;
});

afterAll(async () => {
  await owner.event.update({ where: { id: ev }, data: { deletedAt: new Date() } });
  await Promise.all([db.$disconnect(), owner.$disconnect()]);
});

describe("montar o contrato", () => {
  it("lista os fornecedores aprovados sem contrato; campo, cliente e outros não entram", async () => {
    const l = await listContracts(await sofia(), ev);
    expect(l.items).toHaveLength(0);
    expect(l.pending.find((p) => p.supplierId === energia)).toMatchObject({ proposals: 2, total: 32_500 });
    for (const p of ["rafael", "claudia", "joao"] as Person[]) await expectStatus(listContracts(await actorFor(db, p), ev), 404);
  });

  it("o pré-produtor cria: um contrato por fornecedor, com as propostas aprovadas dele", async () => {
    const c = await createContract(await sofia(), ev, { supplierId: energia });
    contract = c.id;
    expect(c.number).toBe(1);
    const got = await getContract(await sofia(), contract);
    expect(got).toMatchObject({ status: "RASCUNHO", total: 32_500, paymentTerms: "30 dias" });
    expect(got.items.map((i) => i.value).sort((a, b) => a - b)).toEqual([4_000, 28_500]);
    expect(got.can).toMatchObject({ edit: true, changeValue: false, sign: false, cancel: false });
    await expectStatus(createContract(await sofia(), ev, { supplierId: energia }), 409);
    const nothing = await owner.supplier.findFirstOrThrow({ where: { cnpj: CNPJ.luz.replace(/\D/g, "") } });
    await expectStatus(createContract(await sofia(), ev, { supplierId: nothing.id }), 422);
  });

  it("tira e põe item; só o diretor muda o valor (serviço e banco)", async () => {
    const s = await sofia();
    const item = (await getContract(s, contract)).items.find((i) => i.value === 4_000)!;
    await removeContractItem(s, item.id);
    const back = (await getContract(s, contract)).available;
    expect(back).toHaveLength(1);
    const added = await addContractItem(s, contract, { quoteId: back[0]!.quoteId });
    await expectStatus(setContractItemValue(s, added.id, { value: 3_500 }), 403);
    await expectPgError(as("sofia", (tx) => tx.contractItem.update({ where: { id: added.id }, data: { value: 3_500 } })), "42501");
    await expectPgError(as("sofia", (tx) => tx.contractItem.create({ data: { contractId: contract, quoteId: firstQuote, value: 28_500 } })), "23505");
    await setContractItemValue(await marina(), added.id, { value: "3.800,00" });
    expect((await getContract(s, contract)).total).toBe(32_300);
  });

  it("proposta de outro fornecedor não entra (banco)", async () => {
    const other = await owner.supplierQuote.findFirstOrThrow({ where: { eventId: ev, supplierId: som } });
    await expectPgError(as("marina", (tx) => tx.contractItem.create({ data: { contractId: contract, quoteId: other.id, value: 12_000 } })), "23514");
  });

  it("o PDF entra em Documentos como contrato e não vai para o campo", async () => {
    const s = await sofia();
    await expectStatus(attachContractPdf(s, contract, { bytes: new TextEncoder().encode("oi"), name: "x.txt" }), 422);
    const { documentId } = await attachContractPdf(s, contract, PDF("energia"));
    const doc = (await listDocuments(s, ev)).documents.find((x) => x.id === documentId)!;
    expect(doc).toMatchObject({ category: "CONTRATO", visibleToField: false, title: "Contrato nº 1 · Energia Forte Ltda" });
    await expectStatus(updateDocument(await marina(), documentId, { visibleToField: true }), 422);
    await expectPgError(as("marina", (tx) => tx.eventDocument.update({ where: { id: documentId }, data: { visibleToField: true } })), "23514");
    expect(await listFieldDocuments(await actorFor(db, "rafael"), ev)).toHaveLength(0);
  });
});

describe("enviar, assinar e cancelar", () => {
  it("enviado: o texto não muda e o PDF não sai de Documentos", async () => {
    const s = await sofia();
    await updateContract(s, contract, { deliveryNotes: "Entrega 31/08 às 8h no Portão 4; retirada 03/09." });
    await setContractStatus(s, contract, { action: "ENVIAR" });
    await expectStatus(updateContract(s, contract, { notes: "x" }), 409);
    await expectPgError(as("sofia", (tx) => tx.contract.update({ where: { id: contract }, data: { notes: "x" } })), "23514");
    const doc = (await getContract(s, contract)).document!;
    await expectStatus(deleteDocument(await marina(), doc.id), 409);
  });

  it("só o diretor assina (serviço e banco); assinar leva o valor para o Orçamento", async () => {
    await expectStatus(setContractStatus(await sofia(), contract, { action: "ASSINAR", signedOn: "2027-08-20" }), 403);
    await expectPgError(
      as("sofia", (tx) => tx.contract.update({ where: { id: contract }, data: { status: "ASSINADO", signedOn: new Date("2027-08-20"), signedById: d.users.sofia! } })),
      "42501",
    );
    await setContractStatus(await marina(), contract, { action: "ASSINAR", signedOn: "2027-08-20" });
    const costs = await owner.costItem.findMany({ where: { id: { in: [gerador, cabos] } }, select: { id: true, contractedValue: true } });
    expect(Object.fromEntries(costs.map((c) => [c.id === gerador ? "gerador" : "cabos", Number(c.contractedValue)]))).toEqual({ gerador: 28_500, cabos: 3_800 });
    // Assinado não muda mais, nem pelo diretor.
    await expectPgError(as("marina", (tx) => tx.contract.update({ where: { id: contract }, data: { status: "ENVIADO" } })), "23514");
  });

  it("a cotação de uma proposta contratada não reabre", async () => {
    const q = await owner.supplierQuote.findUniqueOrThrow({ where: { id: firstQuote } });
    await expectStatus(setQuoteState(await marina(), q.requestId, { action: "REABRIR" }), 409);
    await expectPgError(as("marina", (tx) => tx.supplierQuote.update({ where: { id: firstQuote }, data: { status: "RECEBIDA" } })), "23514");
  });

  it("só o diretor cancela, com motivo; depois dá para fazer outro contrato", async () => {
    await expectStatus(setContractStatus(await sofia(), contract, { action: "CANCELAR", reason: "x" }), 403);
    await expectStatus(setContractStatus(await marina(), contract, { action: "CANCELAR", reason: " " }), 422);
    await setContractStatus(await marina(), contract, { action: "CANCELAR", reason: "Fornecedor não entregou a garantia" });
    const l = await listContracts(await sofia(), ev);
    expect(l.items[0]).toMatchObject({ number: 1, status: "CANCELADO" });
    expect(l.pending.find((p) => p.supplierId === energia)?.proposals).toBe(2);
    expect((await createContract(await sofia(), ev, { supplierId: energia })).number).toBe(2);
  });

  it("o campo e o cliente não enxergam contratos (banco)", async () => {
    for (const p of ["rafael", "claudia"] as Person[]) {
      expect(await as(p, (tx) => tx.contract.count({ where: { eventId: ev } }))).toBe(0);
      await expectStatus(getContract(await actorFor(db, p), contract), 404);
    }
  });
});
