import ExcelJS from "exceljs";
import { ValidationError } from "../../server/errors";
import { clean, norm, openWorkbook, raw } from "../../server/xlsx";

/**
 * Planilha padrão de funções e áreas (Pré-produção › Funções e briefing):
 * o app gera o .xlsx com o que o evento já tem, a equipe preenche no Excel e
 * envia de volta. As abas e as colunas são encontradas pelo título, então
 * coluna trocada de lugar continua funcionando. Aqui só se lê e escreve o
 * arquivo; quem decide o que muda no evento é o functions-sheet.service.
 */

export const MAX_SHEET_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 2000;
/** Linhas com lista de funções e formato de data/hora prontos para preencher. */
const READY_ROWS = 500;

export const TAB = { help: "Como preencher", areas: "Áreas e equipes", functions: "Funções", activities: "Atividades" } as const;

export interface SheetTeam { name: string; description: string | null }
export interface SheetArea { name: string; description: string | null; teams: SheetTeam[] }
export interface SheetFunction { name: string; description: string | null }
export interface SheetActivity {
  functionName: string;
  title: string;
  /** YYYY-MM-DD */
  day: string | null;
  /** HH:MM */
  startTime: string | null;
  endTime: string | null;
  place: string | null;
}

export interface FunctionsSheet {
  eventName: string;
  areas: SheetArea[];
  functions: SheetFunction[];
  activities: SheetActivity[];
  /** Quem baixa pode mudar áreas e equipes por aqui (Gerente)? Só muda o texto de ajuda. */
  canEditAreas: boolean;
}

export interface ParsedFunctionsSheet {
  /** null = a aba não veio no arquivo. */
  areas: SheetArea[] | null;
  functions: SheetFunction[] | null;
  activities: SheetActivity[] | null;
  warnings: string[];
}

// ───────────────────────────── Escrita ─────────────────────────────

const NAVY = "FF043246";
const CYAN = "FF00E5ED";
const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

function header(ws: ExcelJS.Worksheet, titles: [string, number][]) {
  ws.columns = titles.map(([, width]) => ({ width }));
  const row = ws.getRow(1);
  titles.forEach(([t], i) => {
    const c = row.getCell(i + 1);
    c.value = t;
    c.fill = fill(NAVY);
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.alignment = { vertical: "middle" };
  });
  row.height = 22;
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

const wrap = (row: ExcelJS.Row, cols: number[]) => cols.forEach((c) => (row.getCell(c).alignment = { vertical: "top", wrapText: true }));

/** Dia "YYYY-MM-DD" como data do Excel (sem fuso: meia-noite UTC). */
const excelDay = (day: string) => new Date(`${day}T00:00:00.000Z`);

export async function writeFunctionsSheet(s: FunctionsSheet): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CORE 360";

  // Como preencher (primeira aba: é a que abre).
  const help = wb.addWorksheet(TAB.help);
  help.columns = [{ width: 110 }];
  const lines: [string, "title" | "head" | "text" | "note"][] = [
    ["Planilha de funções e áreas · CORE 360", "title"],
    [`Evento: ${s.eventName}`, "note"],
    ["", "text"],
    ["Como funciona", "head"],
    ["1. Preencha as abas Áreas e equipes, Funções e Atividades. Não mude o nome das abas nem a primeira linha (os títulos).", "text"],
    ["2. Salve em .xlsx e envie em Pré-produção › Funções e briefing › Enviar planilha.", "text"],
    ["3. Antes de gravar, o app mostra o que vai criar e o que vai atualizar. Só grava quando você confirmar.", "text"],
    ["", "text"],
    ["Áreas e equipes", "head"],
    ["Uma linha por equipe: a área na coluna Área e a equipe na coluna Equipe.", "text"],
    ["Para criar só a área, deixe Equipe em branco. A Descrição vale para a equipe (ou para a área, na linha sem equipe).", "text"],
    [
      s.canEditAreas
        ? "Só o Gerente do evento muda áreas e equipes por aqui."
        : "Você pode ver as áreas e equipes, mas só o Gerente do evento pode mudá-las. Se você mexer nesta aba, ela será ignorada.",
      "note",
    ],
    ["", "text"],
    ["Funções", "head"],
    ["Uma linha por função. A descrição aparece para a pessoa em Meu briefing.", "text"],
    ["Quem dá a função a cada pessoa é o app (Funções e briefing), não a planilha.", "text"],
    ["", "text"],
    ["Atividades", "head"],
    ["Uma linha por atividade de cada função. Escolha a função na lista (ela vem da aba Funções).", "text"],
    ["Dia no formato dd/mm/aaaa (ex.: 15/11/2026). Início e Fim no formato HH:MM (ex.: 08:00). Tudo isso é opcional.", "text"],
    ["", "text"],
    ["O que o envio nunca faz", "head"],
    ["Nada é apagado: linha que você tirar da planilha continua no app. Para apagar, use as telas do app.", "text"],
    ["Célula em branco não apaga o que já está no app.", "text"],
    ["Quem já tem uma função continua com ela, e as atividades marcadas como feitas continuam feitas.", "text"],
    ["Nome igual ao que já existe (sem diferença de maiúsculas ou acentos) atualiza; nome novo cria.", "text"],
  ];
  lines.forEach(([t, kind], i) => {
    const c = help.getCell(i + 1, 1);
    c.value = t;
    c.alignment = { wrapText: true, vertical: "top" };
    if (kind === "title") {
      c.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
      c.fill = fill(NAVY);
      help.getRow(i + 1).height = 28;
      c.alignment = { vertical: "middle" };
    } else if (kind === "head") {
      c.font = { bold: true, size: 12, color: { argb: NAVY } };
      c.border = { bottom: { style: "thin", color: { argb: CYAN } } };
    } else if (kind === "note") {
      c.font = { italic: true, color: { argb: "FF555555" } };
    }
  });

  // Áreas e equipes.
  const areas = wb.addWorksheet(TAB.areas);
  header(areas, [["Área", 28], ["Equipe", 28], ["Descrição", 70]]);
  for (const a of s.areas) {
    if (a.teams.length === 0 || a.description) wrap(areas.addRow([a.name, "", a.description ?? ""]), [3]);
    for (const t of a.teams) wrap(areas.addRow([a.name, t.name, t.description ?? ""]), [3]);
  }

  // Funções.
  const fns = wb.addWorksheet(TAB.functions);
  header(fns, [["Função", 34], ["Descrição", 90]]);
  for (const f of s.functions) wrap(fns.addRow([f.name, f.description ?? ""]), [2]);

  // Atividades.
  const acts = wb.addWorksheet(TAB.activities);
  header(acts, [["Função", 30], ["Atividade", 50], ["Dia", 13], ["Início", 9], ["Fim", 9], ["Local", 30]]);
  for (const a of s.activities) {
    const row = acts.addRow([a.functionName, a.title, a.day ? excelDay(a.day) : "", a.startTime ?? "", a.endTime ?? "", a.place ?? ""]);
    wrap(row, [2, 6]);
  }
  const last = Math.max(READY_ROWS, acts.rowCount + 100);
  const fnLast = Math.max(READY_ROWS, fns.rowCount + 100);
  for (let r = 2; r <= last; r++) {
    const row = acts.getRow(r);
    row.getCell(1).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`'${TAB.functions}'!$A$2:$A$${fnLast}`],
      showErrorMessage: true,
      errorStyle: "warning",
      errorTitle: "Função",
      error: "Use uma função da aba Funções (ou crie ela lá primeiro).",
    };
    row.getCell(3).numFmt = "dd/mm/yyyy";
    // Texto: "08:00" fica como foi digitado, sem virar fração do dia.
    row.getCell(4).numFmt = "@";
    row.getCell(5).numFmt = "@";
  }

  return new Uint8Array(await wb.xlsx.writeBuffer());
}

// ───────────────────────────── Leitura ─────────────────────────────

type Cols<K extends string> = Partial<Record<K, number>>;

function findCols<K extends string>(ws: ExcelJS.Worksheet, map: [K, RegExp][]): Cols<K> {
  const cols: Cols<K> = {};
  const row = ws.getRow(1);
  for (let c = 1; c <= Math.min(ws.columnCount, 30); c++) {
    const t = norm(raw(row.getCell(c)).text);
    if (!t) continue;
    const hit = map.find(([k, re]) => cols[k] === undefined && re.test(t));
    if (hit) cols[hit[0]] = c;
  }
  return cols;
}

const pad = (n: number) => String(n).padStart(2, "0");

function validDay(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (y < 2000 || y > 2100 || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Dia da célula: data do Excel, número de série ou texto (dd/mm/aaaa ou aaaa-mm-dd). */
export function readDay(cell: ExcelJS.Cell): string | null | undefined {
  const v = cell.value as unknown;
  const date = v instanceof Date ? v : v && typeof v === "object" && (v as { result?: unknown }).result instanceof Date ? ((v as { result: Date }).result) : null;
  if (date) return validDay(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()) ?? undefined;
  if (typeof v === "number") {
    if (v < 30000 || v > 80000) return undefined;
    const dt = new Date(Math.round((v - 25569) * 86400000));
    return validDay(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()) ?? undefined;
  }
  const t = raw(cell).text.trim();
  if (!t) return null;
  let m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) return validDay(+m[3], +m[2], +m[1]) ?? undefined;
  m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return validDay(+m[1], +m[2], +m[3]) ?? undefined;
  return undefined;
}

/** Hora da célula: hora do Excel (fração do dia ou data 1899), ou texto "8:00", "08h30", "8h". */
export function readTime(cell: ExcelJS.Cell): string | null | undefined {
  const v = cell.value as unknown;
  if (v instanceof Date) return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`;
  if (typeof v === "number") {
    if (v < 0 || v >= 1) return undefined;
    const min = Math.round(v * 1440) % 1440;
    return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
  }
  const t = raw(cell).text.trim().toLowerCase();
  if (!t) return null;
  const m = t.match(/^(\d{1,2})\s*(?:[:h]\s*(\d{2})?\s*(?:min)?)?$/);
  if (!m) return undefined;
  const h = +m[1];
  const min = m[2] ? +m[2] : 0;
  if (h > 23 || min > 59) return undefined;
  return `${pad(h)}:${pad(min)}`;
}

const text = (ws: ExcelJS.Worksheet, r: number, c: number | undefined, max: number) =>
  c === undefined ? null : clean(raw(ws.getRow(r).getCell(c)).text, max);

function tooLong(ws: ExcelJS.Worksheet, r: number, c: number | undefined, max: number) {
  return c !== undefined && raw(ws.getRow(r).getCell(c)).text.trim().length > max;
}

export async function readFunctionsSheet(bytes: Uint8Array): Promise<ParsedFunctionsSheet> {
  const wb = await openWorkbook(bytes, MAX_SHEET_BYTES);
  const warnings: string[] = [];
  const tab = (re: RegExp) => wb.worksheets.find((w) => re.test(norm(w.name)));
  const wsAreas = tab(/^area/);
  const wsFns = tab(/^func/);
  const wsActs = tab(/^ativ/);
  if (!wsAreas && !wsFns && !wsActs) {
    throw new ValidationError("Esta não é a planilha de funções e áreas. Baixe o modelo pelo botão Baixar planilha e preencha nele.");
  }
  const rows = (ws: ExcelJS.Worksheet) => {
    if (ws.rowCount - 1 > MAX_ROWS) throw new ValidationError(`A aba ${ws.name} passou de ${MAX_ROWS} linhas`);
    return Array.from({ length: Math.max(0, ws.rowCount - 1) }, (_, i) => i + 2);
  };
  const where = (ws: ExcelJS.Worksheet, r: number) => `${ws.name}, linha ${r}`;

  // Áreas e equipes: uma linha por equipe; equipe em branco = só a área.
  let areas: SheetArea[] | null = null;
  if (wsAreas) {
    const c = findCols(wsAreas, [["area", /^area/], ["team", /^equipe/], ["description", /^descri/]]);
    if (c.area === undefined) throw new ValidationError(`Não achei a coluna Área na aba ${wsAreas.name}`);
    const byArea = new Map<string, SheetArea>();
    for (const r of rows(wsAreas)) {
      const area = text(wsAreas, r, c.area, 80);
      const team = text(wsAreas, r, c.team, 80);
      const description = text(wsAreas, r, c.description, 2000);
      if (!area) {
        if (team || description) warnings.push(`${where(wsAreas, r)}: falta o nome da área; a linha foi ignorada.`);
        continue;
      }
      if (tooLong(wsAreas, r, c.area, 80) || tooLong(wsAreas, r, c.team, 80)) warnings.push(`${where(wsAreas, r)}: nome com mais de 80 letras foi cortado.`);
      let a = byArea.get(norm(area));
      if (!a) byArea.set(norm(area), (a = { name: area, description: null, teams: [] }));
      if (!team) {
        if (description) a.description = description;
        continue;
      }
      const t = a.teams.find((x) => norm(x.name) === norm(team));
      if (t) t.description = description ?? t.description;
      else a.teams.push({ name: team, description });
    }
    areas = [...byArea.values()];
  }

  // Funções.
  let functions: SheetFunction[] | null = null;
  if (wsFns) {
    const c = findCols(wsFns, [["name", /^func|^nome/], ["description", /^descri/]]);
    if (c.name === undefined) throw new ValidationError(`Não achei a coluna Função na aba ${wsFns.name}`);
    const byName = new Map<string, SheetFunction>();
    for (const r of rows(wsFns)) {
      const name = text(wsFns, r, c.name, 80);
      const description = text(wsFns, r, c.description, 2000);
      if (!name) {
        if (description) warnings.push(`${where(wsFns, r)}: falta o nome da função; a linha foi ignorada.`);
        continue;
      }
      if (tooLong(wsFns, r, c.name, 80)) warnings.push(`${where(wsFns, r)}: nome com mais de 80 letras foi cortado.`);
      const f = byName.get(norm(name));
      if (f) f.description = description ?? f.description;
      else byName.set(norm(name), { name, description });
    }
    functions = [...byName.values()];
  }

  // Atividades.
  let activities: SheetActivity[] | null = null;
  if (wsActs) {
    const c = findCols(wsActs, [
      ["fn", /^func/],
      ["title", /^atividade|^titulo|^tarefa/],
      ["day", /^dia|^data/],
      ["start", /inicio|^das?$|^entrada/],
      ["end", /^fim|termino|^ate$|^saida/],
      ["place", /^local|^onde/],
    ]);
    if (c.fn === undefined || c.title === undefined) throw new ValidationError(`Não achei as colunas Função e Atividade na aba ${wsActs.name}`);
    const byKey = new Map<string, SheetActivity>();
    for (const r of rows(wsActs)) {
      const row = wsActs.getRow(r);
      const functionName = text(wsActs, r, c.fn, 80);
      const title = text(wsActs, r, c.title, 200);
      const place = text(wsActs, r, c.place, 200);
      const day = c.day === undefined ? null : readDay(row.getCell(c.day));
      const startTime = c.start === undefined ? null : readTime(row.getCell(c.start));
      const endTime = c.end === undefined ? null : readTime(row.getCell(c.end));
      if (!functionName && !title) {
        if (place || day || startTime || endTime) warnings.push(`${where(wsActs, r)}: faltam a função e a atividade; a linha foi ignorada.`);
        continue;
      }
      const skip = (why: string) => warnings.push(`${where(wsActs, r)}: ${why}; a linha foi ignorada.`);
      if (!functionName) { skip("falta a função"); continue; }
      if (!title) { skip("falta o nome da atividade"); continue; }
      if (day === undefined) { skip(`dia "${raw(row.getCell(c.day!)).text.trim()}" não é uma data (use dd/mm/aaaa)`); continue; }
      if (startTime === undefined) { skip(`início "${raw(row.getCell(c.start!)).text.trim()}" não é uma hora (use HH:MM)`); continue; }
      if (endTime === undefined) { skip(`fim "${raw(row.getCell(c.end!)).text.trim()}" não é uma hora (use HH:MM)`); continue; }
      if (endTime && !startTime) { skip("tem fim mas não tem início"); continue; }
      if (endTime && startTime && endTime < startTime) { skip("o fim é antes do início"); continue; }
      const key = `${norm(functionName)}|${norm(title)}|${day ?? ""}`;
      if (byKey.has(key)) warnings.push(`${where(wsActs, r)}: atividade repetida; vale a última linha.`);
      byKey.set(key, { functionName, title, day, startTime, endTime, place });
    }
    activities = [...byKey.values()];
  }

  return { areas, functions, activities, warnings };
}
