import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectPgError, expectStatus, ownerDb, type Person } from "../helpers";
import { withUser, type Tx } from "@/server/db/with-user";
import { createEvent } from "@/modules/events/events.service";
import { createCostItem, createCostSection } from "@/modules/costs/costs.service";
import { getBudget } from "@/modules/items/budget.service";
import {
  addSupplierQuote,
  chooseQuote,
  createQuote,
  getQuote,
  listQuotes,
  negotiateProposal,
  setProposalStatus,
  setQuoteState,
  updateSupplierQuote,
} from "@/modules/quotes/quotes.service";

/**
 * Status das propostas e negociação (fase 3C, parte 1). Solicitada é a que
 * ainda não tem valor; a Pré-produção marca Em negociação, cancela e reativa;
 * só o diretor (gestor do evento) negocia o valor, e o recebido fica guardado.
 * Escolher fecha: a escolhida fica Aprovada e as outras Recusadas; reabrir
 * devolve todas à disputa. Pelo serviço e direto no banco.
 */

const db = appDb();
const owner = ownerDb();
const d = demo();
const as = <T>(p: Person, fn: (tx: Tx) => Promise<T>) => withUser(db, d.users[p]!, fn);
const sofia = () => actorFor(db, "sofia");
const marina = () => actorFor(db, "marina");

const CNPJ = ["27.461.538/0001-50", "35.802.746/0001-01", "46.913.057/0001-82"];
const proposal = (n: number, totalValue: number | string | null) => ({
  cnpj: CNPJ[n], companyName: `Proposta ${n} Ltda`, contactName: `Pessoa ${n}`, phone: "(21) 99876-543" + n, email: `p${n}@propostas.dev`, totalValue,
});

let ev: string;
let req: string;
let item: string;
const ids: string[] = [];

beforeAll(async () => {
  const e = await createEvent(await actorFor(db, "admin"), { clientId: d.clients.rock.id, name: "Feira das propostas", startsAt: "2027-10-01T10:00", endsAt: "2027-10-02T22:00" });
  ev = e.id;
  const join = (p: Person, role: "GERENTE" | "PRE_PRODUTOR") =>
    owner.participant.create({ data: { eventId: ev, userId: d.users[p]!, name: p, email: `${p}-prop@rockfestival.dev`, role, joinedAt: new Date() } });
  await join("marina", "GERENTE");
  const s = await join("sofia", "PRE_PRODUTOR");
  const section = await createCostSection(await marina(), ev, { name: "Palco" });
  item = (await createCostItem(await marina(), section.id, { name: "Gerador 500 kVA", quantity: 1, frequency: 1 })).id;
  req = (await createQuote(await sofia(), ev, { title: "Gerador", briefing: "Gerador 500 kVA, 2 diárias.", responsibleId: s.id, costItemId: item })).id;
});

afterAll(async () => {
  await owner.event.update({ where: { id: ev }, data: { deletedAt: new Date() } });
  await Promise.all([db.$disconnect(), owner.$disconnect()]);
});

const statuses = async () => (await getQuote(await sofia(), req)).quotes.map((q) => [q.position, q.status]);

describe("Solicitada e Recebida", () => {
  it("sem valor entra como Solicitada e fica fora do comparativo", async () => {
    const a = await sofia();
    ids.push((await addSupplierQuote(a, req, proposal(0, 30_000))).id);
    const s = await addSupplierQuote(a, req, proposal(1, ""));
    ids.push(s.id);
    expect(s).toMatchObject({ status: "SOLICITADA", totalValue: null, value: null });
    ids.push((await addSupplierQuote(a, req, proposal(2, "28.000,00"))).id);
    const q = await getQuote(a, req);
    expect(q.comparison.rows.map((r) => r.id)).toEqual([ids[0], ids[2]]);
    // Três propostas, mas só duas com valor: o gestor ainda não é avisado.
    expect(q.completedAt).toBeNull();
    expect((await listQuotes(a, ev)).items.find((x) => x.id === req)?.minValue).toBe(28_000);
  });

  it("chegou o valor: a Solicitada vira Recebida; o valor não volta a ficar vazio", async () => {
    const a = await sofia();
    expect(await updateSupplierQuote(a, ids[1]!, { totalValue: "31.500,00" })).toMatchObject({ status: "RECEBIDA", totalValue: 31_500 });
    expect((await getQuote(a, req)).completedAt).not.toBeNull();
    await expectStatus(updateSupplierQuote(a, ids[1]!, { totalValue: "" }), 422);
  });

  it("o banco não aceita Solicitada com valor nem Recebida sem valor", async () => {
    await expectPgError(as("sofia", (tx) => tx.supplierQuote.update({ where: { id: ids[0] }, data: { status: "SOLICITADA" } })), "23514");
    await expectPgError(as("sofia", (tx) => tx.supplierQuote.update({ where: { id: ids[0] }, data: { totalValue: null } })), "23514");
  });
});

describe("andamento e negociação", () => {
  it("a Pré-produção marca Em negociação, cancela e reativa", async () => {
    const a = await sofia();
    expect(await setProposalStatus(a, ids[0]!, { action: "NEGOCIACAO" })).toMatchObject({ status: "EM_NEGOCIACAO" });
    await expectStatus(setProposalStatus(a, ids[0]!, { action: "NEGOCIACAO" }), 409);
    expect(await setProposalStatus(a, ids[1]!, { action: "CANCELAR" })).toMatchObject({ status: "CANCELADA" });
    const q = await getQuote(a, req);
    expect(q.comparison.rows.map((r) => r.id)).not.toContain(ids[1]);
    expect(q.completedAt).toBeNull();
    expect(await setProposalStatus(a, ids[1]!, { action: "REATIVAR" })).toMatchObject({ status: "RECEBIDA" });
  });

  it("só o diretor negocia o valor (serviço e banco)", async () => {
    await expectStatus(negotiateProposal(await sofia(), ids[0]!, { value: "27.000" }), 403);
    await expectPgError(
      as("sofia", (tx) => tx.supplierQuote.update({ where: { id: ids[0] }, data: { negotiatedValue: 27_000, negotiatedAt: new Date(), negotiatedById: d.users.sofia! } })),
      "42501",
    );
    const n = await negotiateProposal(await marina(), ids[0]!, { value: "27.000,00", note: "7% de desconto à vista" });
    expect(n).toMatchObject({ status: "EM_NEGOCIACAO", totalValue: 30_000, negotiatedValue: 27_000, value: 27_000, negotiationNote: "7% de desconto à vista", negotiatedBy: "Marina Gerente" });
    // O negociado passa a valer no comparativo e no Cotado do item.
    const q = await getQuote(await sofia(), req);
    expect(q.comparison.minValue).toBe(27_000);
    expect((await getBudget(await marina(), ev)).items.find((i) => i.id === item)?.quoted).toBe(27_000);
  });

  it("depois da negociação, só o diretor corrige o valor recebido", async () => {
    await expectStatus(updateSupplierQuote(await sofia(), ids[0]!, { totalValue: 29_000 }), 403);
    await expectPgError(as("sofia", (tx) => tx.supplierQuote.update({ where: { id: ids[0] }, data: { totalValue: 29_000 } })), "42501");
    // Mudar outros dados segue livre para a Pré-produção.
    expect(await updateSupplierQuote(await sofia(), ids[0]!, { paymentTerms: "À vista" })).toMatchObject({ paymentTerms: "À vista", totalValue: 30_000 });
  });

  it("não negocia proposta sem valor; desfazer volta a valer o recebido", async () => {
    const m = await marina();
    const tmp = await negotiateProposal(m, ids[2]!, { value: 26_000 });
    expect(tmp.value).toBe(26_000);
    expect((await negotiateProposal(m, ids[2]!, { value: "" })).value).toBe(28_000);
    await setProposalStatus(await sofia(), ids[1]!, { action: "CANCELAR" });
    await expectStatus(negotiateProposal(m, ids[1]!, { value: 1 }), 409);
  });
});

describe("escolher e reabrir", () => {
  it("não escolhe proposta cancelada; o negociado conta para o menor valor", async () => {
    const m = await marina();
    await expectStatus(chooseQuote(m, req, { quoteId: ids[1] }), 422);
    // Recebida a 30 mil, negociada a 27 mil: é a menor, então não pede motivo.
    await chooseQuote(m, req, { quoteId: ids[0], applyToCost: true });
    expect(await statuses()).toEqual([[1, "APROVADA"], [2, "CANCELADA"], [3, "RECUSADA"]]);
    const cost = await owner.costItem.findUniqueOrThrow({ where: { id: item } });
    expect(Number(cost.contractedValue)).toBe(27_000);
  });

  it("Aprovada só a escolhida; com a cotação fechada nada sai de Aprovada/Recusada (banco)", async () => {
    await expectPgError(as("marina", (tx) => tx.supplierQuote.update({ where: { id: ids[1] }, data: { status: "APROVADA" } })), "23514");
    await expectPgError(as("marina", (tx) => tx.supplierQuote.update({ where: { id: ids[2] }, data: { status: "RECEBIDA" } })), "23514");
    await expectStatus(setProposalStatus(await sofia(), ids[2]!, { action: "CANCELAR" }), 409);
  });

  it("reabrir devolve as propostas à disputa", async () => {
    await setQuoteState(await marina(), req, { action: "REABRIR" });
    expect(await statuses()).toEqual([[1, "EM_NEGOCIACAO"], [2, "CANCELADA"], [3, "RECEBIDA"]]);
    // Escolher a mais cara agora pede o motivo.
    await expectStatus(chooseQuote(await marina(), req, { quoteId: ids[2] }), 422);
    await chooseQuote(await marina(), req, { quoteId: ids[2], reason: "Entrega mais cedo" });
    expect(await statuses()).toEqual([[1, "RECUSADA"], [2, "CANCELADA"], [3, "APROVADA"]]);
  });
});
