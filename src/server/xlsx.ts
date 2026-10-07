import ExcelJS from "exceljs";
import { ValidationError } from "./errors";
import { parseDecimal } from "../lib/money";

/**
 * Ajudas para ler planilhas .xlsx enviadas pelo navegador com segurança
 * (matriz de custos, planilha de funções e áreas).
 */

const MAX_UNZIPPED_BYTES = 40 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 500;

/**
 * Confere o .xlsx (um zip) antes de abrir: tamanho descompactado e número de
 * arquivos dentro, para um arquivo pequeno não virar gigabytes na memória.
 */
export function checkZip(bytes: Uint8Array) {
  const fail = () => {
    throw new ValidationError("Arquivo não é uma planilha .xlsx válida");
  };
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) fail();
  const entries = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  if (entries > MAX_ZIP_ENTRIES) throw new ValidationError("Planilha com partes demais");
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) fail();
    const size = view.getUint32(offset + 24, true);
    if (size === 0xffffffff) throw new ValidationError("Planilha grande demais");
    total += size;
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  if (total > MAX_UNZIPPED_BYTES) throw new ValidationError("Planilha grande demais");
}

export type Raw = { text: string; num: number | null; formula: string | null; result: number | null };

export function raw(cell: ExcelJS.Cell): Raw {
  const v = cell.value as unknown;
  const out: Raw = { text: "", num: null, formula: null, result: null };
  if (v === null || v === undefined) return out;
  if (typeof v === "number") return { ...out, text: String(v), num: v };
  if (typeof v === "string") return { ...out, text: v, num: parseDecimal(v) };
  if (typeof v === "boolean" || v instanceof Date) return { ...out, text: String(v) };
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) {
      const t = (o.richText as { text?: string }[]).map((r) => r.text ?? "").join("");
      return { ...out, text: t, num: parseDecimal(t) };
    }
    if (typeof o.formula === "string" || typeof o.sharedFormula === "string") {
      const r = typeof o.result === "number" ? o.result : null;
      // Fórmula compartilhada: o getter devolve a fórmula já traduzida para esta célula.
      const formula = cell.formula || String(o.formula ?? o.sharedFormula);
      return { ...out, formula, result: r, num: r, text: r === null ? String(o.result ?? "") : String(r) };
    }
    if (typeof o.text === "string") return { ...out, text: o.text };
  }
  return out;
}

/** Texto limpo: quebras do Mac/Excel viram "\n", sem espaços sobrando no fim das linhas. */
export function clean(s: string, max: number): string | null {
  const t = s
    .replace(/\r\n?|[\u2028\u2029]/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t ? t.slice(0, max) : null;
}

export const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Confere o zip e abre a planilha; erro amigável se não for um .xlsx. */
export async function openWorkbook(bytes: Uint8Array, maxBytes: number): Promise<ExcelJS.Workbook> {
  if (bytes.length > maxBytes) throw new ValidationError(`Planilha maior que ${Math.round(maxBytes / 1024 / 1024)} MB`);
  checkZip(bytes);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) as unknown as ExcelJS.Buffer);
  } catch {
    throw new ValidationError("Não consegui abrir a planilha. Salve como .xlsx e tente de novo.");
  }
  return wb;
}
