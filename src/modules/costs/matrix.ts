import ExcelJS from "exceljs";
import { ValidationError } from "../../server/errors";
import { clean, norm, openWorkbook, raw } from "../../server/xlsx";
import { costTotals, DEFAULT_RATES, lineSubtotal, type CostBilling, type CostRates, type CostTotals } from "./totals";

/**
 * Leitura e escrita da "matriz de orçamento" em Excel (.xlsx), no layout que
 * a equipe já usa: cabeçalho (cliente, projeto, período...), a linha de
 * títulos "# | Item | Descritivo | Prazo de Pagamento | Valor Unitário |
 * Quantidade | Frequência | Subtotal | Tipo de faturamento", seções numeradas
 * (1, 2, 3...), itens (1.1, 1.2...) e o quadro de totais no fim.
 *
 * A leitura procura as colunas pelo título, então colunas trocadas de lugar
 * continuam funcionando. Os valores calculados (subtotais e totais) não são
 * importados: o app refaz as contas, e a prévia mostra se bateu com o Excel.
 */

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_ITEMS = 2000;
const MAX_SECTIONS = 100;

/** A agência que emite a nota fiscal, como aparece na matriz. */
const AGENCY = "KANALU";
/** Rótulo do faturamento por nota fiscal na matriz da agência. */
export const NF_EXCEL_LABEL = `${AGENCY} (NF)`;

export interface MatrixHeader {
  title: string | null;
  clientName: string | null;
  projectName: string | null;
  period: string | null;
  clientPaymentTerms: string | null;
  author: string | null;
}

export interface MatrixItem {
  name: string;
  description: string | null;
  paymentTerms: string | null;
  /** Em branco na planilha = a definir. */
  unitValue: number | null;
  quantity: number;
  frequency: number | null;
  optional: boolean;
  billing: CostBilling;
}

export interface MatrixSection {
  name: string;
  items: MatrixItem[];
}

export interface Matrix {
  header: MatrixHeader;
  rates: CostRates;
  sections: MatrixSection[];
}

export interface ParsedMatrix extends Matrix {
  warnings: string[];
  /** Totais que o próprio Excel tinha calculado (quando o arquivo traz). */
  excelTotals: { suppliers: number | null; total: number | null };
}

// ───────────────────────────── Leitura ─────────────────────────────

const HEADERS: [keyof Cols, RegExp][] = [
  ["code", /^#$|^n[ºo°]?\.?$|^item #$/],
  ["name", /^item$/],
  ["description", /^descritivo|^descricao/],
  ["terms", /^prazo/],
  ["unit", /^valor unit|^unitario/],
  ["quantity", /^quantidade|^qtd/],
  ["frequency", /^frequencia|^freq/],
  ["subtotal", /^subtotal|^total/],
  ["billing", /faturamento/],
];

interface Cols {
  code?: number;
  name?: number;
  description?: number;
  terms?: number;
  unit?: number;
  quantity?: number;
  frequency?: number;
  subtotal?: number;
  billing?: number;
}

function billingOf(text: string): CostBilling | null {
  const t = norm(text);
  if (!t) return null;
  if (/\bnf\b|nota/.test(t)) return "NOTA_FISCAL";
  if (/diret/.test(t)) return "DIRETO";
  if (/fatura/.test(t)) return "FATURA";
  return null;
}

const pctIn = (s: string) => {
  const m = s.match(/(\d+(?:[.,]\d+)?)\s*%/);
  return m ? Number(m[1].replace(",", ".")) : null;
};

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

export async function readMatrix(bytes: Uint8Array): Promise<ParsedMatrix> {
  const wb = await openWorkbook(bytes, MAX_IMPORT_BYTES);

  // A aba com a linha de títulos (Item + Descritivo); normalmente a "JOB".
  let ws: ExcelJS.Worksheet | undefined;
  let headerRow = 0;
  const cols: Cols = {};
  for (const sheet of wb.worksheets) {
    const last = Math.min(sheet.rowCount, 60);
    for (let r = 1; r <= last && !headerRow; r++) {
      const row = sheet.getRow(r);
      const found: Cols = {};
      for (let c = 1; c <= Math.min(row.cellCount, 30); c++) {
        const t = norm(raw(row.getCell(c)).text);
        for (const [key, re] of HEADERS) if (found[key] === undefined && re.test(t)) found[key] = c;
      }
      if (found.name !== undefined && found.unit !== undefined && found.quantity !== undefined) {
        ws = sheet;
        headerRow = r;
        Object.assign(cols, found);
      }
    }
    if (ws) break;
  }
  if (!ws) {
    throw new ValidationError("Não encontrei a linha de títulos (Item, Valor Unitário, Quantidade). Use a matriz de orçamento.");
  }

  const warnings: string[] = [];
  const header: MatrixHeader = { title: null, clientName: null, projectName: null, period: null, clientPaymentTerms: null, author: null };
  const rates: CostRates = { ...DEFAULT_RATES };

  // Cabeçalho: "Cliente: ...", "Projeto: ...", etc. A primeira linha solta é o título.
  const labels: [keyof MatrixHeader, RegExp][] = [
    ["clientPaymentTerms", /^prazo de pagamento do cliente[^:]*:/i],
    ["clientName", /^cliente\s*:/i],
    ["projectName", /^projeto\s*:/i],
    ["period", /^per[ií]odo\s*:/i],
    ["author", /^autor\s*:/i],
  ];
  for (let r = 1; r < headerRow; r++) {
    for (let c = 1; c <= Math.min(ws.getRow(r).cellCount, 12); c++) {
      const t = raw(ws.getRow(r).getCell(c)).text.trim();
      if (!t) continue;
      const label = labels.find(([, re]) => re.test(t));
      if (label) {
        header[label[0]] = clean(t.replace(label[1], ""), 200);
      } else if (/^honor[aá]rios\s*:/i.test(t)) {
        const p = pctIn(t);
        if (p !== null) rates.feePct = p;
      } else if (!header.title) {
        header.title = clean(t, 200);
      }
      break;
    }
  }

  const cell = (row: ExcelJS.Row, c: number | undefined) => (c === undefined ? raw({ value: null } as ExcelJS.Cell) : raw(row.getCell(c)));
  const sections: MatrixSection[] = [];
  let items = 0;
  let r = headerRow + 1;
  for (; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    // O quadro de totais encerra os itens.
    const tail = [cols.quantity, cols.frequency, cols.subtotal].map((c) => norm(cell(row, c).text)).join(" ");
    if (/subtotal fornecedores|honorarios|total fatura/.test(tail)) break;

    const code = cell(row, cols.code).text.trim();
    const name = clean(cell(row, cols.name).text, 200);
    if (!name) continue;
    const unit = cell(row, cols.unit);
    const qty = cell(row, cols.quantity);
    const hasValues = unit.num !== null || qty.num !== null;
    const where = `Linha ${r}`;

    if (!hasValues && (!code || /^\d+$/.test(code))) {
      if (sections.length >= MAX_SECTIONS) throw new ValidationError(`Mais de ${MAX_SECTIONS} seções`);
      sections.push({ name, items: [] });
      continue;
    }
    if (++items > MAX_ITEMS) throw new ValidationError(`Mais de ${MAX_ITEMS} itens`);
    if (sections.length === 0) sections.push({ name: "Itens", items: [] });

    const freq = cell(row, cols.frequency);
    const sub = cell(row, cols.subtotal);
    const optional = /opcional/i.test(sub.text);
    let frequency = freq.num;
    // "=E*F" (sem a frequência): no Excel a frequência não conta.
    const freqLetter = cols.frequency ? ws.getColumn(cols.frequency).letter : null;
    if (sub.formula && freqLetter && !new RegExp(`\\b${freqLetter}\\$?\\d`, "i").test(sub.formula)) {
      if (frequency !== null && frequency !== 1) warnings.push(`${where} (${name}): a fórmula do Excel ignora a frequência ${frequency}; mantive igual ao Excel.`);
      frequency = null;
    }

    let billing = billingOf(cell(row, cols.billing).text);
    if (!billing) {
      const t = cell(row, cols.billing).text.trim();
      warnings.push(`${where} (${name}): tipo de faturamento ${t ? `"${t}" desconhecido` : "vazio"}; usei Fatura.`);
      billing = "FATURA";
    }

    const item: MatrixItem = {
      name,
      description: clean(cell(row, cols.description).text, 5000),
      paymentTerms: clean(cell(row, cols.terms).text, 60),
      unitValue: unit.num === null ? null : round(Math.max(0, unit.num), 2),
      quantity: round(Math.max(0, qty.num ?? 0), 3),
      frequency: frequency === null ? null : round(Math.max(0, frequency), 3),
      optional,
      billing,
    };
    if (unit.num !== null && unit.num !== item.unitValue) warnings.push(`${where} (${name}): valor unitário arredondado para centavos.`);
    // Subtotal digitado à mão (sem fórmula) e diferente da conta.
    const computed = lineSubtotal(item);
    if (!optional && !sub.formula && sub.num !== null && computed !== null && Math.abs(sub.num - computed) > 0.005) {
      warnings.push(`${where} (${name}): o subtotal digitado (${sub.num}) não bate com unitário × quantidade × frequência; usei a conta.`);
    }
    sections[sections.length - 1].items.push(item);
  }

  // Totais: percentuais pelos rótulos ("Encargos da Fatura - 9,5%") e o que o Excel calculou.
  const excelTotals: ParsedMatrix["excelTotals"] = { suppliers: null, total: null };
  for (; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const texts: string[] = [];
    let pct: number | null = null;
    let value: number | null = null;
    for (let c = 1; c <= row.cellCount; c++) {
      const v = raw(row.getCell(c));
      if (v.text && v.num === null && !v.formula) texts.push(v.text);
      if (v.num !== null && !v.formula && v.num > 0 && v.num < 1) pct = v.num * 100;
      if (v.formula && v.result !== null) value = v.result;
    }
    const label = norm(texts.join(" "));
    if (/subtotal fornecedores/.test(label)) excelTotals.suppliers = value;
    else if (/^honorarios/.test(label) && pct !== null) rates.feePct = round(pct, 2);
    else if (/encargos.*fatura/.test(label)) rates.invoiceTaxPct = pctIn(texts.join(" ")) ?? pct ?? rates.invoiceTaxPct;
    else if (/encargos.*nota|encargos.*nf/.test(label)) rates.nfTaxPct = pctIn(texts.join(" ")) ?? pct ?? rates.nfTaxPct;
    else if (!label && value !== null) excelTotals.total = value; // total geral, sem rótulo
  }

  if (items === 0) throw new ValidationError("Não encontrei itens na planilha");
  for (const [k, v] of Object.entries(rates)) {
    if (!(v >= 0 && v < 100)) throw new ValidationError(`Percentual inválido na planilha (${k})`);
  }
  return { header, rates, sections, warnings, excelTotals };
}

// ───────────────────────────── Escrita ─────────────────────────────

const BRL = '"R$ "#,##0.00';
const PURPLE = "FF703EB6";
const GRAY = "FF7F7F7F";
const BILLING_EXCEL: Record<CostBilling, string> = { FATURA: "FATURA", NOTA_FISCAL: NF_EXCEL_LABEL, DIRETO: "DIRETO" };

const pctLabel = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

/** Gera o .xlsx no layout da matriz, com fórmulas (e os valores já calculados). */
export async function writeMatrix(m: Matrix): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CORE 360";
  const ws = wb.addWorksheet("JOB", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  ws.columns = [4.6, 31, 55, 13.4, 15, 18.5, 10.1, 19, 20].map((width) => ({ width }));
  const white = { argb: "FFFFFFFF" };
  const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

  ws.mergeCells("A2:I2");
  ws.getCell("A2").value = m.header.title ?? "Orçamento";
  ws.getCell("A2").font = { bold: true, size: 14 };
  const h = m.header;
  const lines: [string, string | null][] = [
    ["Cliente", h.clientName],
    ["Projeto", h.projectName],
    ["Período", h.period],
    ["Prazo de Pagamento do Cliente (dias)", h.clientPaymentTerms],
    ["Honorários", pctLabel(m.rates.feePct)],
    ["Autor", h.author],
  ];
  lines.forEach(([label, value], i) => {
    const r = 4 + i;
    ws.mergeCells(r, 1, r, 3);
    ws.getCell(r, 1).value = `${label}: ${value ?? ""}`.trimEnd();
  });

  const head = ws.getRow(11);
  ["#", "Item", "Descritivo", "Prazo de Pagamento", "Valor Unitário", "Quantidade", "Frequência", "Subtotal\n(Unit x Qtd x Freq)", "TIPO DE FATURAMENTO"].forEach((v, i) => {
    const c = head.getCell(i + 1);
    c.value = v;
    c.fill = fill(PURPLE);
    c.font = { bold: true, color: white };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  head.height = 32;

  let r = 12;
  const first = 13;
  m.sections.forEach((s, si) => {
    const sr = ws.getRow(r++);
    sr.getCell(1).value = si + 1;
    sr.getCell(2).value = s.name;
    for (let c = 1; c <= 9; c++) {
      sr.getCell(c).fill = fill(GRAY);
      sr.getCell(c).font = { bold: true, color: white };
    }
    s.items.forEach((it, ii) => {
      const row = ws.getRow(r);
      row.getCell(1).value = `${si + 1}.${ii + 1}`;
      row.getCell(2).value = it.name;
      row.getCell(3).value = it.description ?? "";
      row.getCell(4).value = it.paymentTerms ?? "";
      if (it.unitValue !== null) row.getCell(5).value = it.unitValue;
      row.getCell(6).value = it.quantity;
      if (it.frequency !== null) row.getCell(7).value = it.frequency;
      row.getCell(8).value = it.optional
        ? "OPCIONAL"
        : { formula: it.frequency === null ? `E${r}*F${r}` : `E${r}*F${r}*G${r}`, result: lineSubtotal(it) ?? 0 };
      row.getCell(9).value = BILLING_EXCEL[it.billing];
      row.getCell(5).numFmt = BRL;
      row.getCell(8).numFmt = BRL;
      row.getCell(2).alignment = { vertical: "top", wrapText: true };
      row.getCell(3).alignment = { vertical: "top", wrapText: true };
      for (const c of [1, 4, 5, 6, 7, 8, 9]) row.getCell(c).alignment = { vertical: "top", horizontal: c === 5 || c === 8 ? "right" : "center", wrapText: c === 9 };
      r++;
    });
  });
  const last = Math.max(first, r - 1);
  const items = m.sections.flatMap((s) => s.items);
  const t: CostTotals = costTotals(items, m.rates);

  // Quadro de totais, com as mesmas fórmulas da matriz.
  r++;
  const range = (label: string) => `SUMIF(I${first}:I${last},"${label}",H${first}:H${last})`;
  const row = (label: string, formula: string, result: number, opts: { pct?: number; bold?: boolean } = {}) => {
    const n = r++;
    ws.getCell(n, 6).value = label;
    if (opts.pct !== undefined) {
      ws.getCell(n, 7).value = opts.pct / 100;
      ws.getCell(n, 7).numFmt = "0.0#%";
    }
    ws.getCell(n, 8).value = { formula, result };
    ws.getCell(n, 8).numFmt = BRL;
    if (opts.bold) {
      ws.getCell(n, 6).font = { bold: true };
      ws.getCell(n, 8).font = { bold: true };
    }
    return n;
  };
  const sup = r;
  const fee = sup + 1;
  const direct = sup + 2;
  const inv = sup + 3;
  const nf = sup + 6;
  row("Subtotal Fornecedores", `SUM(H${direct},H${inv},H${nf})`, t.suppliers);
  row("Honorários", `H${sup}*G${fee}`, t.fee, { pct: m.rates.feePct });
  row("Faturamento Direto", range("DIRETO"), t.direct);
  row("Subtotal Fatura", range("FATURA"), t.invoice);
  const invTax = row(`Encargos da Fatura - ${pctLabel(m.rates.invoiceTaxPct)}`, `(H${inv}/(1-G${inv + 1}))-H${inv}`, t.invoiceTax, { pct: m.rates.invoiceTaxPct });
  const invTotal = row("TOTAL FATURA", `H${inv}+H${invTax}`, t.invoiceTotal, { bold: true });
  row(`Subtotal NF - ${AGENCY}`, range(NF_EXCEL_LABEL), t.nf);
  const fee2 = row("Honorários", `H${fee}`, t.fee);
  const nfTax = row(`Encargos Nota Fiscal - ${pctLabel(m.rates.nfTaxPct)}`, `((H${nf}+H${fee2})/(1-G${fee2 + 1}))-(H${nf}+H${fee2})`, t.nfTax, { pct: m.rates.nfTaxPct });
  const nfTotal = row(`TOTAL NF ${AGENCY}`, `SUM(H${nf},H${fee2},H${nfTax})`, t.nfTotal, { bold: true });
  const g = r;
  ws.mergeCells(g, 6, g, 8);
  ws.getCell(g, 6).value = { formula: `H${direct}+H${invTotal}+H${nfTotal}`, result: t.total };
  ws.getCell(g, 6).numFmt = BRL;
  ws.getCell(g, 6).font = { bold: true, size: 13 };
  ws.getCell(g, 6).alignment = { horizontal: "right" };

  return new Uint8Array(await wb.xlsx.writeBuffer());
}
