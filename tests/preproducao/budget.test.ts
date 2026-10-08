import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectPgError, expectStatus, ownerDb, type Person } from "../helpers";
import { withUser, type Tx } from "@/server/db/with-user";
import { memoryStorage, setStorageForTests } from "@/server/storage/storage";
import { createCostItem, createCostSection, deleteCostItem, getCostSheet, importCostSheet, updateCostItem } from "@/modules/costs/costs.service";
import { addSupplierQuote, chooseQuote, createQuote, markQuoteSent, setQuoteState } from "@/modules/quotes/quotes.service";
import { getBudget } from "@/modules/items/budget.service";
import { approvedUse, budgetTotals } from "@/modules/items/budget";
import { writeMatrix, type MatrixItem } from "@/modules/costs/matrix";
import { DEFAULT_RATES } from "@/modules/costs/totals";
import { createEvent } from "@/modules/events/events.service";

/**
 * Orçamento com os 4 valores (fase 2B do roadmap): Estimado da planilha,
 * Cotado da cotação (ou digitado), Contratado e Realizado só do diretor.
 * Saving, estouro e o orçamento aprovado. E a planilha Padrão CORE 360
 * importada por cima atualiza item por item, sem perder o que o item já tem.
 */

const db = appDb();
const owner = ownerDb();
const d = demo();
const rock = d.events.rock.id;
const P = d.participants;
const as = <T>(p: Person, fn: (tx: Tx) => Promise<T>) => withUser(db, d.users[p]!, fn);
const sections: string[] = [];

beforeAll(() => setStorageForTests(memoryStorage()));
afterAll(async () => {
  const items = await owner.costItem.findMany({ where: { sectionId: { in: sections } }, select: { id: true } });
  const reqs = await owner.quoteRequest.findMany({ where: { costItemId: { in: items.map((i) => i.id) } }, select: { id: true } });
  const ids = reqs.map((r) => r.id);
  await owner.quoteRequest.updateMany({ where: { id: { in: ids } }, data: { status: "CANCELADA", chosenQuoteId: null, chosenReason: null, closedAt: null, closedById: null } });
  await owner.supplierQuote.deleteMany({ where: { requestId: { in: ids } } });
  await owner.quoteRequest.deleteMany({ where: { id: { in: ids } } });
  await owner.costSection.deleteMany({ where: { id: { in: sections } } });
  await owner.eventFinances.deleteMany({ where: { eventId: rock } });
  await Promise.all([db.$disconnect(), owner.$disconnect()]);
});

async function section(name: string) {
  const s = await createCostSection(await actorFor(db, "marina"), rock, { name });
  sections.push(s.id);
  return s;
}

const supplier = (n: number, value: number) => ({
  cnpj: ["11.222.333/0001-81", "45.723.174/0001-10", "04.252.011/0001-10"][n - 1],
  companyName: `Fornecedor ${n} Ltda`, phone: "(11) 98765-432" + n, email: `contato${n}@fornecedor.dev`,
  contactName: `Pessoa ${n}`, totalValue: value,
});

describe("contas", () => {
  it("o exemplo do roadmap: saving de R$ 20.000 e estouro de R$ 10.000", () => {
    const t = budgetTotals([
      { estimated: 500_000, quoted: 530_000, contracted: 480_000, actual: 490_000, optional: false },
      { estimated: 9_999, quoted: null, contracted: 1, actual: 1, optional: true },
    ]);
    expect(t).toMatchObject({ estimated: 500_000, quoted: 530_000, contracted: 480_000, actual: 490_000, saving: 20_000, overrun: 10_000, items: 1 });
    expect(approvedUse(480_000, 600_000)).toBe(80);
    expect(approvedUse(1, null)).toBeNull();
  });

  it("saving e estouro só contam itens com os dois valores", () => {
    const t = budgetTotals([
      { estimated: 1000, quoted: null, contracted: null, actual: null, optional: false },
      { estimated: 2000, quoted: null, contracted: 2500, actual: null, optional: false },
    ]);
    expect(t).toMatchObject({ saving: -500, overrun: 0, withContracted: 1, withActual: 0 });
  });
});

describe("os 4 valores no item", () => {
  it("Cotado a Pré-produção digita; Contratado e Realizado só o diretor, também no banco", async () => {
    const sofia = await actorFor(db, "sofia");
    const marina = await actorFor(db, "marina");
    const s = await section("Iluminação");
    const item = await createCostItem(sofia, s.id, { name: "Moving heads", unitValue: 500, quantity: 20 });
    await updateCostItem(sofia, item.id, { quotedValue: "9.800,00" });
    await expectStatus(updateCostItem(sofia, item.id, { contractedValue: 9000 }), 403);
    await expectStatus(updateCostItem(sofia, item.id, { actualValue: 9000 }), 403);
    await expectPgError(as("sofia", (tx) => tx.costItem.update({ where: { id: item.id }, data: { contractedValue: 9000 } })), "42501");
    await expectPgError(as("sofia", (tx) => tx.costItem.update({ where: { id: item.id }, data: { actualValue: 9000 } })), "42501");

    await updateCostItem(marina, item.id, { contractedValue: "9.500,00" });
    expect((await owner.costItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("CONTRATADO");
    await updateCostItem(marina, item.id, { actualValue: 9700 });

    const row = (await getBudget(sofia, rock)).items.find((i) => i.id === item.id)!;
    expect(row).toMatchObject({ estimated: 10_000, quoted: 9_800, quotedFrom: "DIGITADO", contracted: 9_500, actual: 9_700, saving: 500, overrun: 200, category: "ILUMINACAO", costCenter: "TECNICA" });
    // Mexer só no Estimado (planilha) não apaga os outros valores.
    await updateCostItem(sofia, item.id, { unitValue: 450 });
    expect((await getBudget(sofia, rock)).items.find((i) => i.id === item.id)).toMatchObject({ estimated: 9_000, contracted: 9_500, saving: -500 });
  });

  it("Cotado vem sozinho do menor orçamento; escolher o vencedor preenche o Contratado e guarda o Estimado", async () => {
    const sofia = await actorFor(db, "sofia");
    const marina = await actorFor(db, "marina");
    const s = await section("Audiovisual");
    const item = await createCostItem(sofia, s.id, { name: "Telão 6x4", unitValue: 30_000, quantity: 1 });
    await updateCostItem(sofia, item.id, { quotedValue: 1 });
    const { id } = await createQuote(sofia, rock, { title: "Telão", briefing: "Telão 6x4 com operador", responsibleId: P.sofia.id, costItemId: item.id });
    await markQuoteSent(sofia, id);
    const q1 = await addSupplierQuote(sofia, id, supplier(1, 28_000));
    await addSupplierQuote(sofia, id, supplier(2, 26_500));
    let row = (await getBudget(sofia, rock)).items.find((i) => i.id === item.id)!;
    expect(row).toMatchObject({ quoted: 26_500, quotedFrom: "COTACAO", contracted: null });

    const r = await chooseQuote(marina, id, { quoteId: q1.id, reason: "Operador mais experiente", applyToCost: true });
    expect(r.applied).toEqual({ contractedValue: 28_000 });
    row = (await getBudget(sofia, rock)).items.find((i) => i.id === item.id)!;
    expect(row).toMatchObject({ estimated: 30_000, contracted: 28_000, saving: 2_000, status: "CONTRATADO" });
    expect(Number((await owner.costItem.findUniqueOrThrow({ where: { id: item.id } })).unitValue)).toBe(30_000);

    // Cotação cancelada não conta: volta o digitado.
    await setQuoteState(marina, id, { action: "REABRIR" });
    await setQuoteState(marina, id, { action: "CANCELAR" });
    expect((await getBudget(sofia, rock)).items.find((i) => i.id === item.id)).toMatchObject({ quoted: 1, quotedFrom: "DIGITADO" });
  });

  it("totais por categoria e centro de custo, e quanto do orçamento aprovado já está contratado", async () => {
    const marina = await actorFor(db, "marina");
    await owner.eventFinances.upsert({
      where: { eventId: rock }, create: { eventId: rock, approvedBudget: 1_000_000, updatedById: d.users.marina! }, update: { approvedBudget: 1_000_000 },
    });
    const b = await getBudget(marina, rock);
    expect(b.approved.value).toBe(1_000_000);
    expect(b.approved.contractedPct).toBe(Math.round((b.totals.contracted / 1_000_000) * 1000) / 10);
    const sum = (rows: { estimated: number }[]) => Math.round(rows.reduce((a, r) => a + r.estimated, 0) * 100) / 100;
    expect(sum(b.byCategory)).toBe(b.totals.estimated);
    expect(sum(b.byCostCenter)).toBe(b.totals.estimated);
    expect(b.byCategory.find((g) => g.key === "ILUMINACAO")).toMatchObject({ contracted: 9_500, actual: 9_700 });
    expect(b.can.director).toBe(true);
    expect((await getBudget(await actorFor(db, "sofia"), rock)).can.director).toBe(false);
  });

  it("o campo, o Cliente e outro evento não veem o orçamento", async () => {
    for (const p of ["joao", "rafael", "claudia", "paulo"] as const) {
      await expectStatus(getBudget(await actorFor(db, p), rock), 404);
    }
  });
});

describe("planilha Padrão CORE 360 importada por cima", () => {
  const line = (name: string, unitValue: number): MatrixItem => ({
    name, description: null, paymentTerms: "30dd", unitValue, quantity: 1, frequency: null, optional: false, billing: "FATURA",
  });
  const file = (sections: { name: string; items: MatrixItem[] }[]) =>
    writeMatrix({ header: { title: null, clientName: null, projectName: null, period: null, clientPaymentTerms: null, author: null }, rates: DEFAULT_RATES, sections });

  it("atualiza item por item: o que já existe fica com código, área, status e contratado", async () => {
    const ev = await createEvent(await actorFor(db, "admin"), { clientId: d.clients.rock.id, name: "Feira da planilha", startsAt: "2027-11-01T10:00", endsAt: "2027-11-02T22:00" });
    const area = await owner.area.create({ data: { eventId: ev.id, name: "Cenografia" } });
    // O diretor vira Gerente do evento novo: carrega de novo.
    const admin = await actorFor(db, "admin");

    await importCostSheet(admin, ev.id, await file([
      { name: "Cenografia", items: [line("Palco", 10_000), line("Painel", 2_000), line("Sobra", 50)] },
      { name: "Taxas", items: [line("ECAD", 300)] },
    ]), { confirm: true });
    const first = (await getCostSheet(admin, ev.id)).sections.flatMap((s) => s.items);
    const id = (n: string) => first.find((i) => i.name === n)!.id;
    await updateCostItem(admin, id("Palco"), { areaId: area.id, status: "EM_PRODUCAO", contractedValue: 9_000 });
    await updateCostItem(admin, id("ECAD"), { contractedValue: 300 });

    const next = await file([
      { name: "Cenografia", items: [line("Palco", 12_000), line("Tapete", 800)] },
    ]);
    const preview = await importCostSheet(admin, ev.id, next, { confirm: false });
    expect(preview.changes).toEqual({ update: 1, create: 1, remove: 2, keep: 1 });
    expect(preview.warnings.join(" ")).toMatch(/ECAD/);
    await importCostSheet(admin, ev.id, next, { confirm: true });

    const sheet = await getCostSheet(admin, ev.id);
    expect(sheet.sections.map((s) => [s.name, s.items.map((i) => i.name)])).toEqual([["Cenografia", ["Palco", "Tapete"]], ["Taxas", ["ECAD"]]]);
    const palco = await owner.costItem.findUniqueOrThrow({ where: { id: id("Palco") } });
    expect(palco).toMatchObject({ areaId: area.id, status: "EM_PRODUCAO", number: first.find((i) => i.name === "Palco")!.number });
    expect([Number(palco.unitValue), Number(palco.contractedValue)]).toEqual([12_000, 9_000]);
    expect(await owner.costItem.findUnique({ where: { id: id("Painel") } })).toBeNull();
    // Item novo ganha número novo (não reaproveita o de quem saiu).
    const tapete = sheet.sections[0].items[1];
    expect(tapete.number).toBeGreaterThan(Math.max(...first.map((i) => i.number)));

    await owner.costItem.updateMany({ where: { eventId: ev.id }, data: { contractedValue: null } });
    for (const i of (await getCostSheet(admin, ev.id)).sections.flatMap((s) => s.items)) await deleteCostItem(admin, i.id);
  });
});
