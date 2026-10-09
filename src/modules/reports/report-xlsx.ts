import ExcelJS from "exceljs";
import type { Report } from "./catalog";

/**
 * Excel de um relatório: a primeira aba junta a ficha e os resumos; cada
 * tabela vira uma aba. Valores em dinheiro saem como número (formato R$),
 * para a pessoa somar e filtrar no Excel.
 */

const HEAD_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF043246" } } as const;
const MONEY = '"R$" #,##0.00;[Red]-"R$" #,##0.00';

/** Nome de aba: até 31 letras, sem os caracteres que o Excel recusa, sem repetir. */
function sheetName(title: string, used: Set<string>) {
  const base = title.replace(/[\\/*?:[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Aba";
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 27)} (${n})`;
  used.add(name.toLowerCase());
  return name;
}

export async function writeReportXlsx(r: Report): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const used = new Set<string>();

  const summary = wb.addWorksheet(sheetName("Resumo", used));
  summary.columns = [{ width: 30 }, { width: 70 }];
  summary.addRow([`${r.title} · ${r.eventName}`]).font = { bold: true, size: 14 };
  summary.addRow([r.generated]).font = { italic: true, color: { argb: "FF64748B" } };
  for (const b of r.blocks) {
    if (b.kind === "table") continue;
    summary.addRow([]);
    const h = summary.addRow([b.title]);
    h.font = { bold: true, color: { argb: "FFFFFFFF" } };
    h.fill = HEAD_FILL;
    summary.mergeCells(h.number, 1, h.number, 2);
    for (const [k, v] of b.rows) {
      const row = summary.addRow([k, v]);
      row.getCell(1).font = { bold: true };
      row.getCell(2).alignment = { wrapText: true, vertical: "top" };
    }
  }

  for (const b of r.blocks) {
    if (b.kind !== "table") continue;
    const ws = wb.addWorksheet(sheetName(b.title, used));
    ws.columns = b.columns.map((c) => ({ header: c.header, width: c.width }));
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: "FFFFFFFF" } };
    head.fill = HEAD_FILL;
    ws.views = [{ state: "frozen", ySplit: 1 }];
    b.columns.forEach((c, i) => {
      if (c.money) ws.getColumn(i + 1).numFmt = MONEY;
    });
    for (const row of b.rows) ws.addRow(row.map((v) => v ?? ""));
    if (b.rows.length === 0) ws.addRow([b.empty]);
    if (b.note) {
      ws.addRow([]);
      ws.addRow([b.note]).font = { italic: true, color: { argb: "FF64748B" } };
    }
  }

  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** Nome do arquivo só com ASCII: com acento, o Chrome pode trocar o nome por "download". */
export function reportFileName(r: Report) {
  return `${r.title} - ${r.eventName}.xlsx`.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/["\\/]/g, "");
}
