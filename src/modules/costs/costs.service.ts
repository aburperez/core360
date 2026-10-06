import { z } from "zod";
import type { Actor } from "../../server/authz/actor";
import { canUsePreProduction } from "../../server/authz/policy";
import { audit, diff } from "../../server/audit/audit";
import { NotFoundError, ValidationError } from "../../server/errors";
import type { Tx } from "../../server/db/with-user";
import { optionalText, parse, text, uuid } from "../../lib/validation";
import { parseDecimal } from "../../lib/money";
import { requireEventAccess } from "../events/events.service";
import { readMatrix, writeMatrix, type Matrix, type MatrixHeader } from "./matrix";
import { costTotals, DEFAULT_RATES, lineSubtotal, type CostBilling, type CostRates } from "./totals";

/**
 * Pré-produção: planilha de custos (orçamento) do evento, no formato da
 * matriz de orçamento da equipe. Só a Pré-produção (Gerente, Pré-produtor,
 * Admin) vê e edita; para os outros ela não existe (404). A RLS
 * (migration *_pre_producao_custos) aplica o mesmo perímetro no banco.
 */

function requirePreProduction(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canUsePreProduction(actor, eventId)) throw new NotFoundError("Pré-produção");
}

/** Seções que a matriz da equipe usa; "Começar com as seções da matriz" cria estas. */
export const MATRIX_SECTIONS = [
  "Estrutura / Infraestrutura",
  "Cenografia / Ativações",
  "A&B",
  "Artístico",
  "Taxas",
  "Outros",
  "Brindes",
  "Serviços terceirizados",
  "Equipe terceirizada",
  "Agência",
];

const num = (v: unknown) => Number(v ?? 0);

function ratesOf(sheet: { feePct: unknown; invoiceTaxPct: unknown; nfTaxPct: unknown } | null): CostRates {
  if (!sheet) return { ...DEFAULT_RATES };
  return { feePct: num(sheet.feePct), invoiceTaxPct: num(sheet.invoiceTaxPct), nfTaxPct: num(sheet.nfTaxPct) };
}

const itemSelect = {
  id: true, sectionId: true, position: true, name: true, description: true, paymentTerms: true,
  unitValue: true, quantity: true, frequency: true, optional: true, billing: true,
} as const;

type ItemRow = {
  id: string; sectionId: string; position: number; name: string; description: string | null; paymentTerms: string | null;
  unitValue: unknown; quantity: unknown; frequency: unknown; optional: boolean; billing: CostBilling;
};

const toItem = (i: ItemRow) => {
  const line = {
    ...i,
    unitValue: num(i.unitValue),
    quantity: num(i.quantity),
    frequency: i.frequency === null ? null : num(i.frequency),
  };
  return { ...line, subtotal: lineSubtotal(line) };
};

async function loadSheet(tx: Tx, eventId: string) {
  // Em sequência: a transação usa uma conexão só.
  const sheet = await tx.costSheet.findUnique({ where: { eventId } });
  const sections = await tx.costSection.findMany({ where: { eventId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true, name: true, position: true } });
  const items = await tx.costItem.findMany({ where: { eventId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: itemSelect });
  const rates = ratesOf(sheet);
  const rows = items.map(toItem);
  const header: MatrixHeader = {
    title: sheet?.title ?? null,
    clientName: sheet?.clientName ?? null,
    projectName: sheet?.projectName ?? null,
    period: sheet?.period ?? null,
    clientPaymentTerms: sheet?.clientPaymentTerms ?? null,
    author: sheet?.author ?? null,
  };
  return {
    header,
    rates,
    sections: sections.map((s) => {
      const own = rows.filter((i) => i.sectionId === s.id);
      return { ...s, items: own, total: own.filter((i) => !i.optional).reduce((a, i) => a + i.subtotal, 0) };
    }),
    totals: costTotals(rows, rates),
    itemCount: rows.length,
  };
}

/** A planilha inteira do evento: cabeçalho, percentuais, seções, itens e totais. */
export async function getCostSheet(actor: Actor, eventId: string) {
  requirePreProduction(actor, eventId);
  return actor.run((tx) => loadSheet(tx, eventId));
}

const pct = (max: number) => z.coerce.number().min(0, "Mínimo 0%").max(max, `Máximo ${max}%`);
const sheetSchema = z.object({
  title: optionalText(200),
  clientName: optionalText(200),
  projectName: optionalText(200),
  period: optionalText(200),
  clientPaymentTerms: optionalText(200),
  author: optionalText(200),
  feePct: pct(100).optional(),
  invoiceTaxPct: pct(99.99).optional(),
  nfTaxPct: pct(99.99).optional(),
});

/** Cabeçalho (cliente, projeto, período...) e percentuais de honorários e encargos. */
export async function updateCostSheet(actor: Actor, eventId: string, input: unknown) {
  requirePreProduction(actor, eventId);
  const raw = parse(sheetSchema, input);
  // Só o que veio no pedido (optionalText transforma ausente em null).
  const sent = (input ?? {}) as Record<string, unknown>;
  const data = Object.fromEntries(Object.entries(raw).filter(([k]) => k in sent));
  return actor.run(async (tx) => {
    const before = await tx.costSheet.findUnique({ where: { eventId } });
    const saved = await tx.costSheet.upsert({ where: { eventId }, create: { eventId, ...data }, update: data });
    const plain = (o: object | null) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, v !== null && typeof v === "object" && !(v instanceof Date) ? Number(v) : v]));
    await audit(tx, actor, { eventId, entity: "cost_sheet", entityId: eventId, action: before ? "UPDATE" : "CREATE", ...diff(plain(before), plain(saved)) });
    return { ok: true };
  });
}

async function nextPosition(tx: Tx, model: "section" | "item", where: { eventId: string; sectionId?: string }) {
  const agg = model === "section"
    ? await tx.costSection.aggregate({ where, _max: { position: true } })
    : await tx.costItem.aggregate({ where: { eventId: where.eventId, sectionId: where.sectionId }, _max: { position: true } });
  return (agg._max.position ?? 0) + 1;
}

const sectionSchema = z.object({ name: text(120) });

export async function createCostSection(actor: Actor, eventId: string, input: unknown) {
  requirePreProduction(actor, eventId);
  const data = parse(sectionSchema, input);
  return actor.run(async (tx) => {
    const s = await tx.costSection.create({ data: { eventId, name: data.name, position: await nextPosition(tx, "section", { eventId }) } });
    await audit(tx, actor, { eventId, entity: "cost_section", entityId: s.id, action: "CREATE", after: { name: s.name } });
    return s;
  });
}

/** Cria as seções da matriz numa planilha vazia. */
export async function startFromMatrixSections(actor: Actor, eventId: string) {
  requirePreProduction(actor, eventId);
  return actor.run(async (tx) => {
    if (await tx.costSection.count({ where: { eventId } })) throw new ValidationError("A planilha já tem seções");
    await tx.costSection.createMany({ data: MATRIX_SECTIONS.map((name, i) => ({ eventId, name, position: i + 1 })) });
    await audit(tx, actor, { eventId, entity: "cost_sheet", entityId: eventId, action: "CREATE", after: { sections: MATRIX_SECTIONS.length } });
    return { ok: true };
  });
}

async function loadSection(actor: Actor, tx: Tx, id: string) {
  const s = uuid.safeParse(id).success ? await tx.costSection.findUnique({ where: { id } }) : null;
  if (!s || !canUsePreProduction(actor, s.eventId)) throw new NotFoundError("Seção");
  return s;
}

const sectionUpdateSchema = z.object({ name: text(120).optional(), move: z.enum(["up", "down"]).optional() });

/** Renomear ou mudar a seção de lugar. */
export async function updateCostSection(actor: Actor, id: string, input: unknown) {
  const data = parse(sectionUpdateSchema, input);
  return actor.run(async (tx) => {
    const s = await loadSection(actor, tx, id);
    if (data.name !== undefined && data.name !== s.name) {
      await tx.costSection.update({ where: { id: s.id }, data: { name: data.name } });
      await audit(tx, actor, { eventId: s.eventId, entity: "cost_section", entityId: s.id, action: "UPDATE", before: { name: s.name }, after: { name: data.name } });
    }
    if (data.move) await swapNeighbor(tx, "section", s, data.move);
    return { ok: true };
  });
}

/** Troca de posição com o vizinho de cima ou de baixo (renumera para não haver empate). */
async function swapNeighbor(tx: Tx, model: "section" | "item", row: { id: string; eventId: string; sectionId?: string }, dir: "up" | "down") {
  const list = model === "section"
    ? await tx.costSection.findMany({ where: { eventId: row.eventId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true } })
    : await tx.costItem.findMany({ where: { eventId: row.eventId, sectionId: row.sectionId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true } });
  const ids = list.map((r) => r.id);
  const i = ids.indexOf(row.id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  for (const [p, rid] of ids.entries()) {
    if (model === "section") await tx.costSection.update({ where: { id: rid }, data: { position: p + 1 } });
    else await tx.costItem.update({ where: { id: rid }, data: { position: p + 1 } });
  }
}

/** Apaga a seção e os itens dela. */
export async function deleteCostSection(actor: Actor, id: string) {
  return actor.run(async (tx) => {
    const s = await loadSection(actor, tx, id);
    const items = await tx.costItem.count({ where: { sectionId: s.id } });
    await tx.costSection.delete({ where: { id: s.id } });
    await audit(tx, actor, { eventId: s.eventId, entity: "cost_section", entityId: s.id, action: "DELETE", before: { name: s.name, items } });
    return { ok: true };
  });
}

/** Número ou texto no jeito brasileiro ("1.500,50"), arredondado. */
const decimalInput = (max: number, places: number) =>
  z
    .preprocess(
      (v) => (typeof v === "string" ? (parseDecimal(v) ?? v) : v),
      z.number({ message: "Número inválido" }).min(0, "Não pode ser negativo").max(max, "Valor alto demais"),
    )
    .transform((n) => Math.round(n * 10 ** places) / 10 ** places);
const money = decimalInput(1e11, 2);
const amount = decimalInput(1e8, 3);
const itemFields = {
  name: text(200),
  description: optionalText(5000),
  paymentTerms: optionalText(60),
  unitValue: money,
  quantity: amount,
  frequency: amount.nullable().optional(),
  optional: z.boolean().optional(),
  billing: z.enum(["FATURA", "NOTA_FISCAL", "DIRETO"]).optional(),
};
const itemCreateSchema = z.object(itemFields);
const itemUpdateSchema = itemCreateSchema.partial().extend({
  sectionId: uuid.optional(),
  move: z.enum(["up", "down"]).optional(),
});

const auditItem = (i: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(i).map(([k, v]) => [k, v !== null && typeof v === "object" && !(v instanceof Date) ? Number(v) : v]));

/** Novo item na seção; o evento vem da seção (lida no servidor). */
export async function createCostItem(actor: Actor, sectionId: string, input: unknown) {
  const data = parse(itemCreateSchema, input);
  return actor.run(async (tx) => {
    const s = await loadSection(actor, tx, sectionId);
    const item = await tx.costItem.create({
      data: {
        ...data,
        frequency: data.frequency ?? null,
        eventId: s.eventId,
        sectionId: s.id,
        position: await nextPosition(tx, "item", { eventId: s.eventId, sectionId: s.id }),
      },
      select: itemSelect,
    });
    await audit(tx, actor, { eventId: s.eventId, entity: "cost_item", entityId: item.id, action: "CREATE", after: auditItem({ ...data }) });
    return toItem(item);
  });
}

async function loadItem(actor: Actor, tx: Tx, id: string) {
  const i = uuid.safeParse(id).success ? await tx.costItem.findUnique({ where: { id } }) : null;
  if (!i || !canUsePreProduction(actor, i.eventId)) throw new NotFoundError("Item");
  return i;
}

export async function updateCostItem(actor: Actor, id: string, input: unknown) {
  const { move, sectionId, ...data } = parse(itemUpdateSchema, input);
  // Só os campos enviados (optionalText transforma ausente em null).
  const sent = (input ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = Object.fromEntries(Object.entries(data).filter(([k]) => k in sent));
  return actor.run(async (tx) => {
    const i = await loadItem(actor, tx, id);
    if (sectionId && sectionId !== i.sectionId) {
      // Outra seção, do MESMO evento (a FK composta também garante).
      const target = await loadSection(actor, tx, sectionId);
      if (target.eventId !== i.eventId) throw new NotFoundError("Seção");
      patch.sectionId = target.id;
      patch.position = await nextPosition(tx, "item", { eventId: i.eventId, sectionId: target.id });
    }
    const updated = Object.keys(patch).length
      ? await tx.costItem.update({ where: { id: i.id }, data: patch, select: itemSelect })
      : null;
    if (updated) {
      const changes = diff(auditItem(i), auditItem(patch));
      await audit(tx, actor, { eventId: i.eventId, entity: "cost_item", entityId: i.id, action: "UPDATE", ...changes });
    }
    if (move) await swapNeighbor(tx, "item", { id: i.id, eventId: i.eventId, sectionId: (patch.sectionId as string) ?? i.sectionId }, move);
    return toItem(updated ?? (await tx.costItem.findUniqueOrThrow({ where: { id: i.id }, select: itemSelect })));
  });
}

export async function deleteCostItem(actor: Actor, id: string) {
  return actor.run(async (tx) => {
    const i = await loadItem(actor, tx, id);
    await tx.costItem.delete({ where: { id: i.id } });
    await audit(tx, actor, { eventId: i.eventId, entity: "cost_item", entityId: i.id, action: "DELETE", before: auditItem({ name: i.name, unitValue: i.unitValue, quantity: i.quantity }) });
    return { ok: true };
  });
}

// ─────────────────────── Importar e baixar a matriz ───────────────────────

/**
 * Lê a matriz (.xlsx). Sem `confirm`, só devolve a prévia (nada é gravado).
 * Com `confirm`, substitui a planilha do evento pelo conteúdo do arquivo.
 */
export async function importCostSheet(actor: Actor, eventId: string, bytes: Uint8Array, opts: { confirm: boolean; fileName?: string | null }) {
  requirePreProduction(actor, eventId);
  const m = await readMatrix(bytes);
  const items = m.sections.flatMap((s) => s.items);
  const totals = costTotals(items, m.rates);
  const preview = {
    header: m.header,
    rates: m.rates,
    sections: m.sections.map((s) => ({
      name: s.name,
      count: s.items.length,
      total: s.items.filter((i) => !i.optional).reduce((a, i) => a + lineSubtotal(i), 0),
    })),
    itemCount: items.length,
    optionalCount: items.filter((i) => i.optional).length,
    totals,
    excelTotals: m.excelTotals,
    /** O total do app bate com o que o Excel tinha calculado (ao centavo)? */
    matchesExcel: m.excelTotals.total === null ? null : Math.abs(m.excelTotals.total - totals.total) < 0.005,
    warnings: m.warnings.slice(0, 50),
    moreWarnings: Math.max(0, m.warnings.length - 50),
  };

  return actor.run(async (tx) => {
    const existing = await tx.costItem.count({ where: { eventId } });
    if (!opts.confirm) return { ...preview, replaces: existing, saved: false };

    await tx.costItem.deleteMany({ where: { eventId } });
    await tx.costSection.deleteMany({ where: { eventId } });
    const sections = await tx.costSection.createManyAndReturn({
      data: m.sections.map((s, i) => ({ eventId, name: s.name, position: i + 1 })),
      select: { id: true, position: true },
    });
    const idAt = new Map(sections.map((s) => [s.position, s.id]));
    await tx.costItem.createMany({
      data: m.sections.flatMap((s, si) =>
        s.items.map((it, ii) => ({ ...it, eventId, sectionId: idAt.get(si + 1)!, position: ii + 1 })),
      ),
    });
    const sheet = { ...m.header, ...m.rates };
    await tx.costSheet.upsert({ where: { eventId }, create: { eventId, ...sheet }, update: sheet });
    await audit(tx, actor, {
      eventId, entity: "cost_sheet", entityId: eventId, action: "UPDATE",
      after: { imported: opts.fileName?.slice(0, 200) ?? "planilha", sections: m.sections.length, items: items.length, replaced: existing, total: Math.round(totals.total * 100) / 100 },
    });
    return { ...preview, replaces: existing, saved: true };
  });
}

/** Gera o .xlsx da planilha do evento, no layout da matriz. */
export async function exportCostSheet(actor: Actor, eventId: string) {
  requirePreProduction(actor, eventId);
  const { sheet, event } = await actor.run(async (tx) => ({
    sheet: await loadSheet(tx, eventId),
    event: await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { name: true } }),
  }));
  const matrix: Matrix = {
    header: { ...sheet.header, title: sheet.header.title ?? `Orçamento - ${event.name}` },
    rates: sheet.rates,
    sections: sheet.sections.map((s) => ({
      name: s.name,
      items: s.items.map(({ name, description, paymentTerms, unitValue, quantity, frequency, optional, billing }) => ({
        name, description, paymentTerms, unitValue, quantity, frequency, optional, billing,
      })),
    })),
  };
  return { fileName: `Orçamento - ${event.name}.xlsx`, bytes: await writeMatrix(matrix) };
}
