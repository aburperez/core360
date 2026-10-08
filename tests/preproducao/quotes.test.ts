import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectPgError, expectStatus, type Person } from "../helpers";
import { withUser, type Tx } from "@/server/db/with-user";
import { memoryStorage, setStorageForTests } from "@/server/storage/storage";
import { createCostItem, createCostSection } from "@/modules/costs/costs.service";
import {
  addSupplierQuote,
  chooseQuote,
  compareQuotes,
  createQuote,
  deleteSupplierQuote,
  getQuote,
  listQuotes,
  markQuoteSent,
  quoteFile,
  quotesSummary,
  setQuoteSla,
  setQuoteState,
  sniffQuoteFile,
  unitValueFor,
  updateQuote,
  updateSupplierQuote,
} from "@/modules/quotes/quotes.service";
import { formatCnpj, normalizeCnpj } from "@/lib/cnpj";

/**
 * Cotação (Pré-produção): Sofia (Pré-produtora) cuida, Marina (Gerente) define
 * o prazo e escolhe. Ninguém do campo nem de outro evento enxerga. Pelo
 * serviço e direto no banco (RLS e gatilhos seguram sozinhos).
 */

const db = appDb();
const d = demo();
afterAll(() => db.$disconnect());
beforeAll(() => setStorageForTests(memoryStorage()));

const rock = d.events.rock.id;
const as = <T>(p: Person, fn: (tx: Tx) => Promise<T>) => withUser(db, d.users[p]!, fn);
const PDF = new TextEncoder().encode("%PDF-1.4\n% orçamento de teste\n");

const supplier = (n: number, value: number) => ({
  cnpj: ["11.222.333/0001-81", "45.723.174/0001-10", "04.252.011/0001-10"][n - 1],
  companyName: `Fornecedor ${n} Ltda`,
  phone: "(11) 98765-432" + n,
  email: `contato${n}@fornecedor.dev`,
  contactName: `Pessoa ${n}`,
  totalValue: value,
  paymentTerms: "30dd",
});

const cotacaoNotices = (p: Person, requestId: string) =>
  as(p, (tx) => tx.notification.findMany({ where: { type: "COTACAO", link: { contains: requestId } }, orderBy: { createdAt: "asc" } }));

describe("CNPJ e arquivos", () => {
  it("confere os dígitos verificadores", () => {
    expect(normalizeCnpj("11.222.333/0001-81")).toBe("11222333000181");
    expect(normalizeCnpj("11222333000180")).toBeNull();
    expect(normalizeCnpj("00.000.000/0000-00")).toBeNull();
    expect(normalizeCnpj("123")).toBeNull();
    expect(formatCnpj("11222333000181")).toBe("11.222.333/0001-81");
  });

  it("aceita PDF, foto, xlsx e docx pelos bytes", () => {
    expect(sniffQuoteFile(PDF, "x.pdf")?.mime).toBe("application/pdf");
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    expect(sniffQuoteFile(zip, "orc.xlsx")?.ext).toBe("xlsx");
    expect(sniffQuoteFile(zip, "orc.zip")).toBeNull();
    expect(sniffQuoteFile(new TextEncoder().encode("<html>"), "orc.pdf")).toBeNull();
  });

  it("comparativo e valor unitário", () => {
    const c = compareQuotes([{ id: "a", totalValue: 1000 }, { id: "b", totalValue: 1250 }]);
    expect(c.minValue).toBe(1000);
    expect(c.rows[1]).toMatchObject({ diff: 250, diffPct: 25, lowest: false });
    expect(unitValueFor(1000, 2, 4)).toBe(125);
    expect(unitValueFor(1000, 0, null)).toBeNull();
  });
});

describe("Cotação do começo ao fim", () => {
  let id: string;
  let itemId: string;
  const quoteIds: string[] = [];

  it("Pré-produtora cria a cotação ligada a um item da planilha", async () => {
    const marina = await actorFor(db, "marina");
    const section = await createCostSection(marina, rock, { name: "Cotação teste" });
    itemId = (await createCostItem(marina, section.id, { name: "Gerador 500 kVA", quantity: 2, frequency: 3 })).id;

    const sofia = await actorFor(db, "sofia");
    const r = await createQuote(sofia, rock, {
      title: "Gerador para o palco 2", briefing: "2 geradores 500 kVA, 3 diárias, com operador e combustível.",
      responsibleId: d.participants.sofia.id, costItemId: itemId,
    });
    id = r.id;
    const list = await listQuotes(sofia, rock);
    expect(list.items.find((q) => q.id === id)).toMatchObject({ stage: "RASCUNHO", mine: true, count: 0 });
  });

  it("só Gerente ou Pré-produtor do evento cuida da cotação (serviço e banco)", async () => {
    const sofia = await actorFor(db, "sofia");
    await expectStatus(updateQuote(sofia, id, { responsibleId: d.participants.rafael.id }), 422);
    await expectPgError(
      as("sofia", (tx) => tx.quoteRequest.update({ where: { id }, data: { responsibleId: d.participants.rafael.id } })),
      "23514",
    );
  });

  it("campo, cliente e outro evento não enxergam", async () => {
    for (const p of ["rafael", "joao", "claudia", "paulo"] as Person[]) {
      const a = await actorFor(db, p);
      await expectStatus(getQuote(a, id), 404);
      await expectStatus(listQuotes(a, rock), 404);
      const rows = await as(p, (tx) => tx.quoteRequest.findMany({ where: { id } }));
      expect(rows).toHaveLength(0);
      await expectPgError(as(p, (tx) => tx.$queryRaw`SELECT app.notify_quote(${id}::uuid, 'ENVIADA')`), "42501");
    }
  });

  it("enviar avisa a Gerente; só ela define o prazo", async () => {
    const sofia = await actorFor(db, "sofia");
    await expectStatus(markQuoteSent(sofia, id, { slaMinutes: 60 }), 403);
    await markQuoteSent(sofia, id);
    expect((await getQuote(sofia, id)).stage).toBe("SEM_PRAZO");
    const toMarina = await cotacaoNotices("marina", id);
    expect(toMarina.map((n) => n.title)).toEqual(["Cotação enviada: defina o prazo"]);
    expect(toMarina[0]!.link).toBe(`/eventos/${rock}/pre-producao/cotacoes/${id}`);
    expect(await cotacaoNotices("sofia", id)).toHaveLength(0);

    await expectStatus(setQuoteSla(sofia, id, { slaMinutes: 120 }), 403);
    await expectPgError(as("sofia", (tx) => tx.quoteRequest.update({ where: { id }, data: { slaMinutes: 5, dueAt: new Date() } })), "42501");

    const marina = await actorFor(db, "marina");
    await setQuoteSla(marina, id, { slaMinutes: 2 * 1440 });
    const q = await getQuote(sofia, id);
    expect(q.stage).toBe("NO_PRAZO");
    expect(q.slaMinutes).toBe(2880);
    expect((await cotacaoNotices("sofia", id)).map((n) => n.title)[0]).toMatch(/^Prazo da cotação: até \d\d\/\d\d \d\d:\d\d$/);
  });

  it("até 3 orçamentos, com arquivo; o terceiro avisa a Gerente", async () => {
    const sofia = await actorFor(db, "sofia");
    await expectStatus(addSupplierQuote(sofia, id, { ...supplier(1, 1000), cnpj: "11.222.333/0001-80" }), 422);
    quoteIds.push((await addSupplierQuote(sofia, id, supplier(1, 30000), { bytes: PDF, name: "orcamento-1.pdf" })).id);
    quoteIds.push((await addSupplierQuote(sofia, id, supplier(2, 27500))).id);
    await expectStatus(addSupplierQuote(sofia, id, supplier(3, 31000), { bytes: new TextEncoder().encode("oi"), name: "a.pdf" }), 422);
    quoteIds.push((await addSupplierQuote(sofia, id, supplier(3, 31000))).id);
    await expectStatus(addSupplierQuote(sofia, id, supplier(1, 1)), 422);

    const q = await getQuote(sofia, id);
    expect(q.quotes.map((x) => x.position)).toEqual([1, 2, 3]);
    expect(q.quotes[0]).toMatchObject({ cnpj: "11222333000181", hasFile: true, fileName: "orcamento-1.pdf" });
    expect(q.comparison.minValue).toBe(27500);
    expect(q.stage).toBe("DECIDIR");
    expect((await cotacaoNotices("marina", id)).map((n) => n.title)).toContain("3 orçamentos recebidos: compare e escolha");

    // No banco: quarto orçamento não existe.
    await expectPgError(
      as("sofia", (tx) => tx.supplierQuote.create({
        data: { ...supplier(1, 1), cnpj: "11222333000181", phone: "+5511987654321", eventId: rock, requestId: id, position: 4, createdById: d.users.sofia! },
      })),
      "23514",
    );

    const file = await quoteFile(sofia, quoteIds[0]!);
    expect(new TextDecoder().decode(file.body!)).toContain("%PDF");
    await expectStatus(quoteFile(await actorFor(db, "rafael"), quoteIds[0]!), 404);
    expect(await as("rafael", (tx) => tx.supplierQuote.findMany({ where: { requestId: id } }))).toHaveLength(0);

    // Sai um, deixa de estar completa; volta, completa de novo.
    await deleteSupplierQuote(sofia, quoteIds.pop()!);
    expect((await getQuote(sofia, id)).stage).toBe("NO_PRAZO");
    quoteIds.push((await addSupplierQuote(sofia, id, supplier(3, 31000))).id);
    await updateSupplierQuote(sofia, quoteIds[2]!, { totalValue: 29000 });
    expect((await quotesSummary(sofia, rock)).toDecide).toBeGreaterThanOrEqual(1);
  });

  it("só a Gerente escolhe; fora do menor valor, pede o motivo; o valor vira o Contratado do item", async () => {
    const sofia = await actorFor(db, "sofia");
    const marina = await actorFor(db, "marina");
    await expectStatus(chooseQuote(sofia, id, { quoteId: quoteIds[1] }), 403);
    await expectPgError(as("sofia", (tx) => tx.quoteRequest.update({ where: { id }, data: { status: "CANCELADA" } })), "42501");
    await expectStatus(chooseQuote(marina, id, { quoteId: quoteIds[0] }), 422);

    const r = await chooseQuote(marina, id, { quoteId: quoteIds[0], reason: "Único com operador 24 h", applyToCost: true });
    expect(r.applied).toEqual({ contractedValue: 30000 });
    const item = await as("marina", (tx) => tx.costItem.findUniqueOrThrow({ where: { id: itemId } }));
    expect([Number(item.contractedValue), item.status]).toEqual([30000, "CONTRATADO"]);

    const q = await getQuote(sofia, id);
    expect(q).toMatchObject({ status: "FECHADA", chosenQuoteId: quoteIds[0], chosenReason: "Único com operador 24 h", stage: "FECHADA" });
    expect((await cotacaoNotices("sofia", id)).map((n) => n.title)).toContain("Cotação fechada: orçamento escolhido");

    await expectStatus(addSupplierQuote(sofia, id, supplier(1, 1)), 409);
    await expectStatus(updateSupplierQuote(sofia, quoteIds[1]!, { totalValue: 1 }), 409);
    await expectStatus(setQuoteState(sofia, id, { action: "REABRIR" }), 403);

    await setQuoteState(marina, id, { action: "REABRIR" });
    expect(await getQuote(sofia, id)).toMatchObject({ status: "ENVIADA", chosenQuoteId: null, stage: "DECIDIR" });
    await chooseQuote(marina, id, { quoteId: quoteIds[1] });
    expect((await getQuote(marina, id)).chosenQuoteId).toBe(quoteIds[1]);
  });
});
