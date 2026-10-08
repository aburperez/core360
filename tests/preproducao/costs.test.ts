import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectPgError, expectStatus, ownerDb, type Person } from "../helpers";
import { withUser, type Tx } from "@/server/db/with-user";
import {
  createCostItem,
  createCostSection,
  deleteCostItem,
  deleteCostSection,
  exportCostSheet,
  getCostSheet,
  importCostSheet,
  startFromMatrixSections,
  updateCostItem,
  updateCostSection,
  updateCostSheet,
} from "@/modules/costs/costs.service";
import { readMatrix } from "@/modules/costs/matrix";
import {
  addReceiptPhoto,
  checkReceipt,
  listReceipts,
  receiptPhoto,
  sendToField,
  setItemReceiver,
  setSectionReceiver,
} from "@/modules/receipts/receipts.service";
import { HIDDEN_VALUE } from "@/modules/receipts/field-text";
import { memoryStorage, setStorageForTests } from "@/server/storage/storage";
import { costTotals, DEFAULT_RATES } from "@/modules/costs/totals";

/**
 * Planilha de custos (Pré-produção): só a Pré-produtora (Sofia), a Gerente
 * (Marina) e o Admin entram. As contas seguem a matriz de orçamento da equipe
 * e a importação/exportação usa o mesmo layout. Pelo serviço e direto no
 * banco (a RLS segura sozinha).
 */

const db = appDb();
const owner = ownerDb();
const d = demo();
const rock = d.events.rock.id;
afterAll(() => Promise.all([db.$disconnect(), owner.$disconnect()]));
beforeAll(async () => {
  setStorageForTests(memoryStorage());
  // Importar por cima mantém os itens com cotação ou contratado (fase 2B). Aqui
  // a planilha começa sem eles, seja qual for a ordem dos arquivos de teste.
  await owner.quoteRequest.updateMany({ where: { eventId: rock }, data: { costItemId: null } });
  await owner.costItem.updateMany({ where: { eventId: rock }, data: { contractedValue: null, actualValue: null } });
});

const congresso = d.events.congresso.id;
const as = <T>(p: Person, fn: (tx: Tx) => Promise<T>) => withUser(db, d.users[p]!, fn);
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.005);

/**
 * Matriz de exemplo no layout da equipe, com as manias da planilha real:
 * fórmula sem a frequência (=E*F), item "OPCIONAL", NF da agência, quantidade
 * como texto, quebra de linha do Mac e o quadro de totais com os valores que o
 * Excel já tinha calculado.
 */
async function sampleMatrix() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("JOB");
  ws.getCell("A2").value = "ABC - 0007/26 - FESTA";
  ws.getCell("A4").value = "Cliente: Banco ABC";
  ws.getCell("A5").value = "Projeto: Festa de fim de ano";
  ws.getCell("A6").value = "Período: 11/12/2026";
  ws.getCell("A7").value = "Prazo de Pagamento do Cliente (dias): 30dd";
  ws.getCell("A8").value = "Honorários: 12%";
  ws.getCell("A9").value = "Autor: Abu";
  ["#", "Item", "Descritivo", "Prazo de Pagamento", "Valor Unitário", "Quantidade", "Frequência", "Subtotal\n(Unit x Qtd x Freq)", "TIPO DE FATURAMENTO"]
    .forEach((v, i) => (ws.getRow(11).getCell(i + 1).value = v));
  const rows: (string | number | { formula: string } | null)[][] = [
    [1, "ESTRUTURA"],
    ["1.1", "Painel de LED", "Painel P2 Processado   \nOperador incluso", "30dd ", 1000, 2, 3, { formula: "E13*F13*G13" }, "FATURA"],
    ["1.2", "Sonoplasta", "", "30dd", 500, "1", 2, { formula: "E14*F14" }, "FATURA"],
    [2, "ATIVAÇÕES"],
    ["2.1", "Photobooth", "Opcional", "30dd", 9000, 1, 1, "OPCIONAL", "FATURA"],
    ["2.2", "Atendimento", "Agência", "A vista", 3000, 1, 1, { formula: "E17*F17*G17" }, "KANALU (NF)"],
    ["2.3", "Taxa ECAD", "", "15dd", 200, 1, 1, { formula: "E18*F18*G18" }, "DIRETO"],
  ];
  rows.forEach((r, i) => r.forEach((v, c) => (ws.getRow(12 + i).getCell(c + 1).value = v as ExcelJS.CellValue)));
  // Valores esperados (como o Excel calcularia), com honorários de 12%.
  const fatura = 1000 * 2 * 3 + 500 * 1;
  const nf = 3000;
  const direto = 200;
  const sup = fatura + nf + direto;
  const fee = sup * 0.12;
  const invTax = fatura / (1 - 0.095) - fatura;
  const nfTax = (nf + fee) / (1 - 0.175) - (nf + fee);
  const total = direto + fatura + invTax + nf + fee + nfTax;
  const label = (r: number, text: string, formula: string, result: number, pct?: number) => {
    ws.getCell(`F${r}`).value = text;
    if (pct !== undefined) ws.getCell(`G${r}`).value = pct;
    ws.getCell(`H${r}`).value = { formula, result };
  };
  label(20, "Subtotal Fornecedores", "SUM(H22,H23,H26)", sup);
  label(21, "Honorários", "H20*G21", fee, 0.12);
  label(22, "Faturamento Direto", 'SUMIF(I13:I18,"DIRETO",H13:H18)', direto);
  label(23, "Subtotal Fatura", 'SUMIF(I13:I18,"FATURA",H13:H18)', fatura);
  label(24, "Encargos da Fatura - 9,5%", "(H23/(1-9.5%))-H23", invTax);
  label(25, "TOTAL FATURA", "SUM(H23+H24)", fatura + invTax);
  label(26, "Subtotal NF- KANALU", 'SUMIF(I13:I18,"KANALU (NF)",H13:H18)', nf);
  label(27, "Honorários", "H21", fee);
  label(28, "Encargos Nota Fiscal - 17,5%", "((H26+H27)/(1-17.5%))-(H26+H27)", nfTax);
  label(29, "TOTAL NF KANALU", "SUM(H26,H27,H28)", nf + fee + nfTax);
  ws.getCell("F30").value = { formula: "H22+H25+H29", result: total };
  return { bytes: new Uint8Array(await wb.xlsx.writeBuffer()), total, sup };
}

describe("contas iguais às da matriz", () => {
  it("honorários sobre fornecedores, encargos por dentro, opcional fora", () => {
    const t = costTotals(
      [
        { unitValue: 100, quantity: 2, frequency: 3, optional: false, billing: "FATURA" },
        { unitValue: 50, quantity: 1, frequency: null, optional: false, billing: "NOTA_FISCAL" },
        { unitValue: 10, quantity: 1, frequency: 1, optional: false, billing: "DIRETO" },
        { unitValue: 999, quantity: 1, frequency: 1, optional: true, billing: "FATURA" },
      ],
      DEFAULT_RATES,
    );
    expect(t.suppliers).toBe(660);
    close(t.fee, 99);
    close(t.invoiceTax, 600 / 0.905 - 600);
    close(t.nfTax, 149 / 0.825 - 149);
    close(t.total, 10 + 600 / 0.905 + 149 / 0.825);
    expect(t.optional).toBe(999);
  });
});

describe("leitura da matriz em Excel", () => {
  it("lê cabeçalho, seções, itens e percentuais, e o total bate com o Excel", async () => {
    const { bytes, total } = await sampleMatrix();
    const m = await readMatrix(bytes);
    expect(m.header).toMatchObject({ title: "ABC - 0007/26 - FESTA", clientName: "Banco ABC", period: "11/12/2026", author: "Abu" });
    expect(m.rates).toEqual({ feePct: 12, invoiceTaxPct: 9.5, nfTaxPct: 17.5 });
    expect(m.sections.map((s) => [s.name, s.items.length])).toEqual([["ESTRUTURA", 2], ["ATIVAÇÕES", 3]]);
    const [led, sono] = m.sections[0].items;
    expect(led).toMatchObject({ description: "Painel P2\nProcessado\nOperador incluso", paymentTerms: "30dd", frequency: 3 });
    // "=E14*F14": a frequência 2 não entra na conta, como no Excel (e vira aviso).
    expect(sono).toMatchObject({ quantity: 1, frequency: null });
    expect(m.warnings.join(" ")).toMatch(/Sonoplasta.*ignora a frequência/);
    expect(m.sections[1].items.map((i) => [i.optional, i.billing])).toEqual([[true, "FATURA"], [false, "NOTA_FISCAL"], [false, "DIRETO"]]);
    close(costTotals(m.sections.flatMap((s) => s.items), m.rates).total, total);
    close(m.excelTotals.total!, total);
  });

  it("recusa arquivo que não é planilha e planilha sem a linha de títulos", async () => {
    await expectStatus(readMatrix(new TextEncoder().encode("não sou um xlsx")), 422);
    await expectStatus(readMatrix(new Uint8Array(3 * 1024 * 1024)), 422);
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("x").getCell("A1").value = "nada aqui";
    await expectStatus(readMatrix(new Uint8Array(await wb.xlsx.writeBuffer())), 422);
  });
});

describe("quem entra na planilha de custos", () => {
  it("Pré-produtora, Gerente e Admin; Head, Operacional, Cliente e Gerente de outro evento não", async () => {
    for (const person of ["sofia", "marina", "admin"] as const) {
      await getCostSheet(await actorFor(db, person), rock);
    }
    const { bytes } = await sampleMatrix();
    for (const person of ["rafael", "joao", "claudia", "paulo"] as const) {
      const actor = await actorFor(db, person);
      await expectStatus(getCostSheet(actor, rock), 404);
      await expectStatus(updateCostSheet(actor, rock, { feePct: 1 }), 404);
      await expectStatus(createCostSection(actor, rock, { name: "Indevida" }), 404);
      await expectStatus(importCostSheet(actor, rock, bytes, { confirm: false }), 404);
      await expectStatus(exportCostSheet(actor, rock), 404);
    }
  });
});

describe("importar, editar e baixar", () => {
  it("a prévia não grava; a confirmação substitui a planilha e fica no histórico", async () => {
    const sofia = await actorFor(db, "sofia");
    const pre = await createCostSection(sofia, rock, { name: "Será substituída" });
    await createCostItem(sofia, pre.id, { name: "Antigo", unitValue: 1, quantity: 1 });
    const { bytes, total } = await sampleMatrix();

    const preview = await importCostSheet(sofia, rock, bytes, { confirm: false });
    expect(preview).toMatchObject({ saved: false, itemCount: 5, optionalCount: 1, matchesExcel: true });
    expect(preview.replaces).toBeGreaterThan(0);
    expect((await getCostSheet(sofia, rock)).sections.map((s) => s.name)).toContain("Será substituída");

    const done = await importCostSheet(sofia, rock, bytes, { confirm: true, fileName: "matriz.xlsx" });
    expect(done.saved).toBe(true);
    const sheet = await getCostSheet(sofia, rock);
    expect(sheet.sections.map((s) => s.name)).toEqual(["ESTRUTURA", "ATIVAÇÕES"]);
    expect(sheet.header.clientName).toBe("Banco ABC");
    expect(sheet.rates.feePct).toBe(12);
    close(sheet.totals.total, total);
    const log = await as("marina", (tx) => tx.auditLog.findFirst({ where: { eventId: rock, entity: "cost_sheet" }, orderBy: { occurredAt: "desc" } }));
    expect(log?.after).toMatchObject({ imported: "matriz.xlsx", items: 5 });
  });

  it("Baixar Excel gera a matriz que volta igual ao importar", async () => {
    const marina = await actorFor(db, "marina");
    const sheet = await getCostSheet(marina, rock);
    const file = await exportCostSheet(marina, rock);
    expect(file.fileName).toMatch(/\.xlsx$/);
    const back = await readMatrix(file.bytes);
    expect(back.sections.map((s) => s.items.map((i) => i.name))).toEqual(sheet.sections.map((s) => s.items.map((i) => i.name)));
    expect(back.rates).toEqual(sheet.rates);
    close(costTotals(back.sections.flatMap((s) => s.items), back.rates).total, sheet.totals.total);
    close(back.excelTotals.total!, sheet.totals.total);
  });

  it("Gerente edita item, muda de seção e apaga; percentuais mudam os totais", async () => {
    const marina = await actorFor(db, "marina");
    const sheet = await getCostSheet(marina, rock);
    const [estrutura, ativacoes] = sheet.sections;
    const item = await createCostItem(marina, estrutura.id, { name: "Gerador", unitValue: "1500,50", quantity: 2, frequency: null, billing: "FATURA" });
    expect(item).toMatchObject({ unitValue: 1500.5, subtotal: 3001 });
    const moved = await updateCostItem(marina, item.id, { sectionId: ativacoes.id, optional: true });
    expect(moved).toMatchObject({ sectionId: ativacoes.id, optional: true, name: "Gerador" });
    await updateCostItem(marina, item.id, { move: "up" });
    await deleteCostItem(marina, item.id);
    const after = await getCostSheet(marina, rock);
    expect(after.sections.flatMap((x) => x.items).some((i) => i.id === item.id)).toBe(false);

    const before = (await getCostSheet(marina, rock)).totals.total;
    await updateCostSheet(marina, rock, { feePct: 20 });
    expect((await getCostSheet(marina, rock)).totals.total).toBeGreaterThan(before);
    await expectStatus(updateCostSheet(marina, rock, { invoiceTaxPct: 100 }), 422);
    await updateCostSheet(marina, rock, { feePct: 12 });
  });

  it("seções: renomear, mudar de lugar, apagar com os itens; começar com as seções da matriz só na planilha vazia", async () => {
    const marina = await actorFor(db, "marina");
    const s = await createCostSection(marina, rock, { name: "Transporte" });
    await createCostItem(marina, s.id, { name: "Van", unitValue: 800, quantity: 2 });
    await updateCostSection(marina, s.id, { name: "Transporte e frete", move: "up" });
    let sheet = await getCostSheet(marina, rock);
    const idx = sheet.sections.findIndex((x) => x.id === s.id);
    expect(sheet.sections[idx].name).toBe("Transporte e frete");
    expect(idx).toBe(sheet.sections.length - 2);
    await deleteCostSection(marina, s.id);
    sheet = await getCostSheet(marina, rock);
    expect(sheet.sections.some((x) => x.id === s.id)).toBe(false);
    await expectStatus(startFromMatrixSections(marina, rock), 422);

    const paulo = await actorFor(db, "paulo");
    await startFromMatrixSections(paulo, congresso);
    expect((await getCostSheet(paulo, congresso)).sections).toHaveLength(10);
  });

  it("ids de outro evento não servem: item, seção e mover item para seção alheia", async () => {
    const marina = await actorFor(db, "marina");
    const paulo = await actorFor(db, "paulo");
    const rockSection = (await getCostSheet(marina, rock)).sections[0];
    const rockItem = rockSection.items[0];
    const otherSection = (await getCostSheet(paulo, congresso)).sections[0];
    await expectStatus(updateCostItem(paulo, rockItem.id, { name: "Hack" }), 404);
    await expectStatus(deleteCostItem(paulo, rockItem.id), 404);
    await expectStatus(createCostItem(paulo, rockSection.id, { name: "Hack", unitValue: 1, quantity: 1 }), 404);
    await expectStatus(deleteCostSection(paulo, rockSection.id), 404);
    await expectStatus(updateCostItem(marina, rockItem.id, { sectionId: otherSection.id }), 404);
  });
});

describe("o banco segura sozinho (RLS)", () => {
  it("Head, Operacional e Cliente não leem nem gravam custos, mesmo direto no banco", async () => {
    for (const person of ["rafael", "joao", "claudia"] as const) {
      expect(await as(person, (tx) => tx.costItem.count({ where: { eventId: rock } }))).toBe(0);
      expect(await as(person, (tx) => tx.costSheet.count({ where: { eventId: rock } }))).toBe(0);
      await expectPgError(as(person, (tx) => tx.costSection.create({ data: { eventId: rock, name: "X", position: 99 } })), "42501");
      const r = await as(person, (tx) => tx.costItem.updateMany({ where: { eventId: rock }, data: { unitValue: 0 } }));
      expect(r.count).toBe(0);
    }
    expect(await as("sofia", (tx) => tx.costItem.count({ where: { eventId: rock } }))).toBeGreaterThan(0);
  });

  it("item não pode apontar para seção de outro evento, e valores negativos não entram", async () => {
    const otherSection = await as("paulo", (tx) => tx.costSection.findFirstOrThrow({ where: { eventId: congresso } }));
    await expectPgError(
      as("admin", (tx) => tx.costItem.create({ data: { eventId: rock, sectionId: otherSection.id, position: 1, name: "X", unitValue: 1, quantity: 1 } })),
      "23503",
    );
    await expectPgError(
      as("admin", (tx) => tx.costItem.create({ data: { eventId: congresso, sectionId: otherSection.id, position: 1, name: "X", unitValue: -1, quantity: 1 } })),
      "23514",
    );
  });
});

describe("itens da planilha no campo (sem valores)", () => {
  const P = d.participants;

  it("valor em branco fica 'a definir' e fora do total", async () => {
    const marina = await actorFor(db, "marina");
    const sheet = await getCostSheet(marina, rock);
    const before = sheet.totals.total;
    const item = await createCostItem(marina, sheet.sections[0].id, { name: "Gerador reserva", unitValue: null, quantity: 1 });
    expect(item).toMatchObject({ unitValue: null, subtotal: null });
    const after = await getCostSheet(marina, rock);
    expect(after.totals.total).toBe(before);
    expect(after.totals.undefinedCount).toBe(1);
    await updateCostItem(marina, item.id, { unitValue: "2.000,00" });
    expect((await getCostSheet(marina, rock)).totals.total).toBeGreaterThan(before);
    await deleteCostItem(marina, item.id);
  });

  it("só o Gerente escolhe quem recebe, e precisa ser alguém do campo deste evento", async () => {
    const marina = await actorFor(db, "marina");
    const sofia = await actorFor(db, "sofia");
    const [estrutura] = (await getCostSheet(marina, rock)).sections;
    const item = estrutura.items[0];
    await expectStatus(setItemReceiver(sofia, item.id, { participantId: P.joao.id }), 403);
    await expectStatus(sendToField(sofia, rock), 403);
    await expectPgError(as("sofia", (tx) => tx.costItem.update({ where: { id: item.id }, data: { receiverId: P.joao.id } })), "42501");
    for (const bad of [P.claudia.id, P.sofia.id, P.joaoCongresso.id]) {
      await expectStatus(setItemReceiver(marina, item.id, { participantId: bad }), 422);
    }
    await setItemReceiver(marina, item.id, { participantId: P.joao.id });
  });

  it("enviar para o campo: cada um vê só os seus itens, e nenhum valor sai da Pré-produção", async () => {
    const marina = await actorFor(db, "marina");
    const sheet = await getCostSheet(marina, rock);
    const [, ativacoes] = sheet.sections;
    await setSectionReceiver(marina, ativacoes.id, { participantId: P.carlos.id });
    // Preço escrito no descritivo também não vai.
    await updateCostItem(marina, sheet.sections[0].items[0].id, { description: "12 horas. Hora extra R$ 350,00 e diária US$ 1.200" });
    const r = await sendToField(marina, rock);
    expect(r.created).toBe(1 + ativacoes.items.length);

    const joao = await listReceipts(await actorFor(db, "joao"), rock);
    expect(joao.rows.map((x) => x.name)).toEqual([sheet.sections[0].items[0].name]);
    const carlos = await listReceipts(await actorFor(db, "carlos"), rock);
    expect(carlos.rows).toHaveLength(ativacoes.items.length);
    expect((await listReceipts(await actorFor(db, "rafael"), rock)).rows).toEqual([]);
    const everyone = (await listReceipts(marina, rock)).rows;
    expect(everyone).toHaveLength(r.created);
    // Na ordem da planilha, não em ordem alfabética.
    expect(everyone.map((x) => x.name)).toEqual([sheet.sections[0].items[0], ...ativacoes.items].map((i) => i.name));
    // Nada de preço no que o campo recebe.
    const json = JSON.stringify([joao, carlos]);
    for (const key of ["unitValue", "subtotal", "billing", "paymentTerms"]) expect(json).not.toContain(key);
    expect(joao.rows[0].description).toBe(`12 horas. Hora extra ${HIDDEN_VALUE} e diária ${HIDDEN_VALUE}`);
    expect((await getCostSheet(marina, rock)).sections[0].items[0].receipt?.stale).toBe(false);
    // Nem direto no banco: quem recebe não lê a planilha.
    expect(await as("joao", (tx) => tx.costItem.count({ where: { eventId: rock } }))).toBe(0);
    expect(await as("joao", (tx) => tx.itemReceipt.count({ where: { eventId: rock } }))).toBe(1);
    // A Pré-produção não abre os recebimentos do campo (ela acompanha pela planilha).
    await expectStatus(listReceipts(await actorFor(db, "sofia"), rock), 404);
  });

  it("quem recebe confere; diferente pede explicação; ninguém confere item alheio", async () => {
    const joao = await actorFor(db, "joao");
    const carlos = await actorFor(db, "carlos");
    const [mine] = (await listReceipts(joao, rock)).rows;
    await expectStatus(checkReceipt(joao, mine.id, { status: "DIFERENTE", receivedQuantity: 1 }), 422);
    await expectStatus(checkReceipt(carlos, mine.id, { status: "OK" }), 404);
    const done = await checkReceipt(joao, mine.id, { status: "DIFERENTE", receivedQuantity: "1", receivedDescription: "Painel P3", note: "Faltou um painel" });
    expect(done).toMatchObject({ status: "DIFERENTE", receivedQuantity: 1, note: "Faltou um painel" });
    // Direto no banco: quem recebe não muda o item enviado nem assina por outra pessoa.
    await expectPgError(as("joao", (tx) => tx.itemReceipt.update({ where: { id: mine.id }, data: { quantity: 99 } })), "42501");
    await expectPgError(as("joao", (tx) => tx.itemReceipt.update({ where: { id: mine.id }, data: { receivedById: d.users.carlos! } })), "42501");

    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 64 }, (_, i) => i)]);
    const photo = await addReceiptPhoto(joao, mine.id, jpeg);
    expect((await receiptPhoto(await actorFor(db, "marina"), photo.id)).mimeType).toBe("image/jpeg");
    await expectStatus(receiptPhoto(carlos, photo.id), 404);
    await expectStatus(addReceiptPhoto(carlos, mine.id, jpeg), 404);

    // A planilha mostra a conferência para a Pré-produção.
    const sheet = await getCostSheet(await actorFor(db, "sofia"), rock);
    const item = sheet.sections[0].items[0];
    expect(item.receipt).toMatchObject({ status: "DIFERENTE", receivedQuantity: 1, stale: false });
    expect(item.receipt!.photoIds).toEqual([photo.id]);
    expect(sheet.field).toMatchObject({ different: 1, outdated: false });
  });

  it("item mudou depois do envio: reenviar volta a conferência para aguardando", async () => {
    const marina = await actorFor(db, "marina");
    const item = (await getCostSheet(marina, rock)).sections[0].items[0];
    await updateCostItem(marina, item.id, { quantity: item.quantity + 1 });
    const sheet = await getCostSheet(marina, rock);
    expect(sheet.sections[0].items[0].receipt?.stale).toBe(true);
    expect(sheet.field.outdated).toBe(true);
    expect(await sendToField(marina, rock)).toMatchObject({ updated: 1, created: 0 });
    const [mine] = (await listReceipts(await actorFor(db, "joao"), rock)).rows;
    expect(mine).toMatchObject({ status: "PENDENTE", quantity: item.quantity + 1, note: null });
  });

  it("item já no campo: importar o mesmo arquivo mantém a conferência; tirar o item só o Gerente", async () => {
    const marina = await actorFor(db, "marina");
    const sofia = await actorFor(db, "sofia");
    const item = (await getCostSheet(marina, rock)).sections[0].items[0];
    await expectStatus(deleteCostItem(sofia, item.id), 409);
    const { bytes } = await sampleMatrix();
    // O mesmo item continua: a conferência dele no campo fica.
    const same = await importCostSheet(sofia, rock, bytes, { confirm: true });
    expect(same.changes).toMatchObject({ remove: 0 });
    expect((await listReceipts(await actorFor(db, "joao"), rock)).rows.map((r) => r.costItemId)).toEqual([item.id]);

    // Um arquivo sem esse item tira ele do app: só o Gerente.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    ws.eachRow((row) => { if (row.getCell(2).text === item.name) row.getCell(2).value = "Outro painel"; });
    const without = new Uint8Array(await wb.xlsx.writeBuffer());
    const preview = await importCostSheet(sofia, rock, without, { confirm: false });
    expect(preview).toMatchObject({ canReplaceSent: false, sentToField: 1 });
    await expectStatus(importCostSheet(sofia, rock, without, { confirm: true }), 409);
    await expectPgError(as("marina", (tx) => tx.costItem.delete({ where: { id: item.id } })), "23503");

    await importCostSheet(marina, rock, without, { confirm: true });
    expect((await listReceipts(marina, rock)).rows.map((r) => r.costItemId)).not.toContain(item.id);
    expect((await listReceipts(await actorFor(db, "joao"), rock)).rows).toEqual([]);
    await importCostSheet(marina, rock, bytes, { confirm: true });
  });

});
