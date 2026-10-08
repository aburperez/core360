import { z } from "zod";
import type { Actor } from "../../server/authz/actor";
import { canReviewSla, canSendToField, canUsePreProduction, clientCan } from "../../server/authz/policy";
import { audit, diff } from "../../server/audit/audit";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../server/errors";
import type { Tx } from "../../server/db/with-user";
import { optionalText, parse, text, uuid } from "../../lib/validation";
import { parseDecimal } from "../../lib/money";
import { requireEventAccess } from "../events/events.service";
import { readMatrix, writeMatrix, type Matrix, type MatrixHeader } from "./matrix";
import { costTotals, DEFAULT_RATES, lineSubtotal, type CostBilling, type CostRates } from "./totals";
import { fieldText } from "../receipts/field-text";
import { norm } from "../../server/xlsx";
import { canSetItemStatus, COST_CENTERS, ITEM_CATEGORIES, ITEM_STATUS_LABEL, ITEM_STATUSES, itemCode, type ItemCategory, type ItemStatus } from "../items/item-meta";

/**
 * Pré-produção: planilha de custos (orçamento) do evento, no formato da
 * matriz de orçamento da equipe. Só a Pré-produção (Gerente, Pré-produtor,
 * Admin) vê e edita; para os outros ela não existe (404). A RLS
 * (migration *_pre_producao_custos) aplica o mesmo perímetro no banco.
 * O Cliente, quando o Gerente libera os custos, só lê (getClientCosts).
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
  unitValue: true, quantity: true, frequency: true, optional: true, billing: true, receiverId: true,
  number: true, category: true, status: true, unit: true, location: true, responsibleId: true,
} as const;

type ItemRow = {
  id: string; sectionId: string; position: number; name: string; description: string | null; paymentTerms: string | null;
  unitValue: unknown; quantity: unknown; frequency: unknown; optional: boolean; billing: CostBilling; receiverId: string | null;
  number: number; category: ItemCategory | null; status: ItemStatus; unit: string | null; location: string | null; responsibleId: string | null;
};

const toItem = (i: ItemRow) => {
  const line = {
    ...i,
    unitValue: i.unitValue === null ? null : num(i.unitValue),
    quantity: num(i.quantity),
    frequency: i.frequency === null ? null : num(i.frequency),
  };
  return { ...line, subtotal: lineSubtotal(line) };
};

async function loadSheet(tx: Tx, eventId: string) {
  // Em sequência: a transação usa uma conexão só.
  const sheet = await tx.costSheet.findUnique({ where: { eventId } });
  const { number: eventNumber } = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { number: true } });
  const sections = await tx.costSection.findMany({ where: { eventId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true, name: true, position: true } });
  const items = await tx.costItem.findMany({ where: { eventId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: itemSelect });
  // Campo: quem recebe e a conferência de cada item (a cópia enviada não tem valores).
  const receiverIds = [...new Set(items.map((i) => i.receiverId).filter((x): x is string => !!x))];
  const people = receiverIds.length
    ? await tx.participant.findMany({ where: { id: { in: receiverIds } }, select: { id: true, name: true } })
    : [];
  const receipts = await tx.itemReceipt.findMany({
    where: { eventId },
    select: {
      costItemId: true, receiverId: true, sectionName: true, name: true, description: true, quantity: true, unit: true, location: true,
      status: true, receivedQuantity: true, receivedDescription: true, note: true, receivedAt: true, sentAt: true,
      photos: { select: { id: true } },
    },
  });
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const receiptOf = new Map(receipts.map((r) => [r.costItemId, r]));
  const sectionName = new Map(sections.map((x) => [x.id, x.name]));
  const rates = ratesOf(sheet);
  const rows = items.map((raw) => {
    const i = toItem(raw);
    const r = receiptOf.get(i.id);
    return {
      ...i,
      code: itemCode(eventNumber, i.category, i.number),
      receiverName: i.receiverId ? (nameOf.get(i.receiverId) ?? null) : null,
      receipt: r
        ? {
            status: r.status,
            sentAt: r.sentAt,
            receivedAt: r.receivedAt,
            receivedQuantity: r.receivedQuantity === null ? null : Number(r.receivedQuantity),
            receivedDescription: r.receivedDescription,
            note: r.note,
            photoIds: r.photos.map((p) => p.id),
            /** O item mudou depois de enviado: falta "Enviar para o campo" de novo. */
            stale: r.receiverId !== i.receiverId || r.name !== fieldText(i.name) || r.description !== fieldText(i.description)
              || Number(r.quantity) !== i.quantity || r.sectionName !== sectionName.get(i.sectionId)
              || r.unit !== i.unit || r.location !== i.location,
          }
        : null,
    };
  });
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
      return { ...s, items: own, total: own.filter((i) => !i.optional).reduce((a, i) => a + (i.subtotal ?? 0), 0) };
    }),
    totals: costTotals(rows, rates),
    itemCount: rows.length,
    field: {
      withReceiver: rows.filter((i) => i.receiverId).length,
      sent: receipts.length,
      ok: receipts.filter((r) => r.status === "OK").length,
      different: receipts.filter((r) => r.status === "DIFERENTE").length,
      pending: receipts.filter((r) => r.status === "PENDENTE").length,
      /** Algo mudou (pessoa ou item) desde o último envio. */
      outdated: rows.some((i) => (i.receiverId && !i.receipt) || i.receipt?.stale) || receipts.length > rows.filter((i) => i.receiverId).length,
    },
  };
}

/**
 * Custos para o Cliente: a planilha com valores, só para ler, quando o
 * Gerente liberou. Sem quem recebe e sem a conferência do campo.
 */
export async function getClientCosts(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!clientCan(actor, eventId, "costs")) throw new NotFoundError("Custos");
  const sheet = await actor.run((tx) => loadSheet(tx, eventId));
  return {
    header: sheet.header,
    rates: sheet.rates,
    totals: sheet.totals,
    itemCount: sheet.itemCount,
    sections: sheet.sections.map((s) => ({
      id: s.id, name: s.name, total: s.total,
      items: s.items.map((i) => ({
        id: i.id, name: i.name, description: i.description, paymentTerms: i.paymentTerms, unitValue: i.unitValue,
        quantity: i.quantity, frequency: i.frequency, optional: i.optional, billing: i.billing, subtotal: i.subtotal,
      })),
    })),
  };
}

/** A planilha inteira do evento: cabeçalho, percentuais, seções, itens e totais. */
export async function getCostSheet(actor: Actor, eventId: string) {
  requirePreProduction(actor, eventId);
  const sheet = await actor.run((tx) => loadSheet(tx, eventId));
  return { ...sheet, can: { sendToField: canSendToField(actor, eventId) } };
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
    await dropReceipts(actor, tx, s.eventId, { costItem: { sectionId: s.id } });
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
  /** Em branco = a definir. */
  unitValue: money.nullable().optional(),
  quantity: amount,
  frequency: amount.nullable().optional(),
  optional: z.boolean().optional(),
  billing: z.enum(["FATURA", "NOTA_FISCAL", "DIRETO"]).optional(),
};
const itemCreateSchema = z.object(itemFields);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida").refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Data inválida");
const itemUpdateSchema = itemCreateSchema.partial().extend({
  sectionId: uuid.optional(),
  move: z.enum(["up", "down"]).optional(),
  // Item do evento (fase 2).
  areaId: uuid.nullable().optional(),
  category: z.enum(ITEM_CATEGORIES).nullable().optional(),
  /** Só o diretor; vazio = o da categoria. */
  costCenter: z.enum(COST_CENTERS).nullable().optional(),
  unit: optionalText(20),
  responsibleId: uuid.nullable().optional(),
  neededOn: day.nullable().optional(),
  /** Cronograma (fase 4A): o item que precisa ficar pronto antes deste. */
  dependsOnId: uuid.nullable().optional(),
  location: optionalText(200),
  status: z.enum(ITEM_STATUSES).optional(),
  notes: optionalText(2000),
  // Os 4 valores (fase 2B): Cotado digitado vale só sem cotação; Contratado e Realizado, só o diretor.
  quotedValue: money.nullable().optional(),
  contractedValue: money.nullable().optional(),
  actualValue: money.nullable().optional(),
});

/**
 * Confere os campos do Item: área e responsável do mesmo evento, centro de
 * custo só pelo diretor e o status dentro do que a pessoa pode mudar.
 */
async function checkItemFields(actor: Actor, tx: Tx, i: { id?: string; eventId: string; status: ItemStatus; costCenter: string | null }, patch: Record<string, unknown>) {
  const director = canReviewSla(actor, i.eventId);
  if (("contractedValue" in patch || "actualValue" in patch) && !director) {
    throw new ForbiddenError("Só o diretor de produção preenche o Contratado e o Realizado");
  }
  if ("costCenter" in patch && patch.costCenter !== i.costCenter && !director) {
    throw new ForbiddenError("Só o diretor de produção muda o centro de custo");
  }
  if (patch.status !== undefined && !canSetItemStatus(i.status, patch.status as ItemStatus, director)) {
    throw new ForbiddenError(`Só o diretor de produção muda o item de ${ITEM_STATUS_LABEL[i.status]} para ${ITEM_STATUS_LABEL[patch.status as ItemStatus]}`);
  }
  if (patch.areaId) {
    const a = await tx.area.findFirst({ where: { id: patch.areaId as string, eventId: i.eventId, deletedAt: null }, select: { id: true } });
    if (!a) throw new ValidationError("Área não encontrada neste evento", { areaId: ["Escolha uma área do evento"] });
  }
  if (patch.responsibleId) {
    const p = await tx.participant.findFirst({ where: { id: patch.responsibleId as string, eventId: i.eventId, active: true, deletedAt: null }, select: { id: true } });
    if (!p) throw new ValidationError("Responsável não encontrado neste evento", { responsibleId: ["Escolha alguém do evento"] });
  }
  if (patch.dependsOnId) await checkDependency(tx, i, patch.dependsOnId as string);
  if (typeof patch.neededOn === "string") patch.neededOn = new Date(`${patch.neededOn}T00:00:00.000Z`);
}

/** "Depende de": outro item do mesmo evento, sem fazer círculo (o banco também confere). */
async function checkDependency(tx: Tx, i: { id?: string; eventId: string }, dependsOnId: string) {
  const err = (msg: string) => new ValidationError(msg, { dependsOnId: [msg] });
  if (dependsOnId === i.id) throw err("O item não depende dele mesmo");
  let cur: string | null = dependsOnId;
  for (let hops = 0; cur && hops < 200; hops++) {
    const row: { id: string; dependsOnId: string | null } | null = await tx.costItem.findFirst({ where: { id: cur, eventId: i.eventId }, select: { id: true, dependsOnId: true } });
    if (!row) throw err("Escolha um item deste evento");
    if (row.dependsOnId && row.dependsOnId === i.id) throw err("Este item já é necessário para o outro: a dependência faria um círculo");
    cur = row.dependsOnId;
  }
}

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
    await checkItemFields(actor, tx, i, patch);
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
    await dropReceipts(actor, tx, i.eventId, { costItemId: i.id });
    await tx.costItem.delete({ where: { id: i.id } });
    await audit(tx, actor, { eventId: i.eventId, entity: "cost_item", entityId: i.id, action: "DELETE", before: auditItem({ name: i.name, unitValue: i.unitValue, quantity: i.quantity }) });
    return { ok: true };
  });
}

/**
 * Apagar itens que já foram para o campo apaga a conferência deles: só o
 * gestor (que é quem envia) pode. O banco também barra (FK RESTRICT + RLS).
 */
async function dropReceipts(actor: Actor, tx: Tx, eventId: string, where: { costItemId?: string | { in: string[] }; costItem?: { sectionId: string } }) {
  const n = await tx.itemReceipt.count({ where: { eventId, ...where } });
  if (!n) return;
  if (!canSendToField(actor, eventId)) {
    throw new ConflictError(n === 1
      ? "Este item já foi enviado para o campo. Só o gerente pode apagá-lo."
      : `${n} itens já foram enviados para o campo. Só o gerente pode apagá-los.`);
  }
  await tx.itemReceipt.deleteMany({ where: { eventId, ...where } });
  await audit(tx, actor, { eventId, entity: "cost_sheet", entityId: eventId, action: "DELETE", after: { receiptsRemoved: n } });
}

// ─────────────────────── Importar e baixar a matriz ───────────────────────

/**
 * Lê a planilha Padrão CORE 360 (.xlsx). Sem `confirm`, só devolve a prévia
 * (nada é gravado). Com `confirm`, atualiza a planilha do evento item por item:
 * o item com o mesmo nome na mesma seção continua sendo o mesmo (código,
 * área, responsável, status, cotações, contratado e conferência no campo
 * ficam); o que é novo entra; o que saiu do arquivo sai do app, menos os que
 * já têm cotação, contratado ou realizado, que ficam e viram aviso.
 */
export async function importCostSheet(actor: Actor, eventId: string, bytes: Uint8Array, opts: { confirm: boolean; fileName?: string | null }) {
  requirePreProduction(actor, eventId);
  const m = await readMatrix(bytes);
  const items = m.sections.flatMap((s) => s.items);
  const totals = costTotals(items, m.rates);
  const base = {
    header: m.header,
    rates: m.rates,
    sections: m.sections.map((s) => ({
      name: s.name,
      count: s.items.length,
      total: s.items.filter((i) => !i.optional).reduce((a, i) => a + (lineSubtotal(i) ?? 0), 0),
    })),
    itemCount: items.length,
    optionalCount: items.filter((i) => i.optional).length,
    totals,
    excelTotals: m.excelTotals,
    /** O total do app bate com o que o Excel tinha calculado (ao centavo)? */
    matchesExcel: m.excelTotals.total === null ? null : Math.abs(m.excelTotals.total - totals.total) < 0.005,
  };

  return actor.run(async (tx) => {
    const sections = await tx.costSection.findMany({ where: { eventId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true, name: true } });
    const current = await tx.costItem.findMany({
      where: { eventId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: {
        id: true, sectionId: true, name: true, contractedValue: true, actualValue: true,
        _count: { select: { quotes: true } }, receipt: { select: { id: true } },
      },
    });

    // Seção pelo nome; item pelo nome dentro da seção (repetidos, na ordem).
    const freeSections = [...sections];
    const sectionFor = m.sections.map((s) => {
      const k = freeSections.findIndex((x) => norm(x.name) === norm(s.name));
      return k < 0 ? null : freeSections.splice(k, 1)[0];
    });
    const freeItems = [...current];
    const matchFor = m.sections.map((s, si) =>
      s.items.map((it) => {
        const sec = sectionFor[si];
        if (!sec) return null;
        const k = freeItems.findIndex((x) => x.sectionId === sec.id && norm(x.name) === norm(it.name));
        return k < 0 ? null : freeItems.splice(k, 1)[0];
      }),
    );
    // O que saiu do arquivo: fica quem já tem cotação, contratado ou realizado.
    const keep = freeItems.filter((x) => x._count.quotes > 0 || x.contractedValue !== null || x.actualValue !== null);
    const remove = freeItems.filter((x) => !keep.includes(x));
    const sentRemoved = remove.filter((x) => x.receipt).length;
    const warnings = [...m.warnings];
    if (keep.length) {
      warnings.push(`${keep.length} ${keep.length === 1 ? "item que não está no arquivo continua" : "itens que não estão no arquivo continuam"} no app porque já ${keep.length === 1 ? "tem" : "têm"} cotação, contratado ou realizado: ${keep.slice(0, 5).map((x) => x.name).join(", ")}${keep.length > 5 ? "…" : ""}.`);
    }
    const update = matchFor.flat().filter(Boolean).length;
    const preview = {
      ...base,
      warnings: warnings.slice(0, 50),
      moreWarnings: Math.max(0, warnings.length - 50),
      /** Itens que já estavam na planilha. */
      replaces: current.length,
      changes: { update, create: items.length - update, remove: remove.length, keep: keep.length },
      /** Itens que saem e já tinham ido para o campo (a conferência deles sai junto). */
      sentToField: sentRemoved,
      canReplaceSent: canSendToField(actor, eventId),
    };
    if (!opts.confirm) return { ...preview, saved: false };

    if (sentRemoved) await dropReceipts(actor, tx, eventId, { costItemId: { in: remove.filter((x) => x.receipt).map((x) => x.id) } });
    if (remove.length) await tx.costItem.deleteMany({ where: { id: { in: remove.map((x) => x.id) } } });
    for (const [si, s] of m.sections.entries()) {
      const sec = sectionFor[si]
        ? await tx.costSection.update({ where: { id: sectionFor[si]!.id }, data: { name: s.name, position: si + 1 }, select: { id: true } })
        : await tx.costSection.create({ data: { eventId, name: s.name, position: si + 1 }, select: { id: true } });
      for (const [ii, it] of s.items.entries()) {
        const found = matchFor[si][ii];
        if (found) await tx.costItem.update({ where: { id: found.id }, data: { ...it, sectionId: sec.id, position: ii + 1 } });
        else await tx.costItem.create({ data: { ...it, eventId, sectionId: sec.id, position: ii + 1 } });
      }
    }
    // Seções que não estão no arquivo: os itens que ficaram vão para o fim; vazias saem.
    const last = m.sections.length;
    for (const [k, sec] of freeSections.entries()) {
      if (await tx.costItem.count({ where: { sectionId: sec.id } })) await tx.costSection.update({ where: { id: sec.id }, data: { position: last + k + 1 } });
      else await tx.costSection.delete({ where: { id: sec.id } });
    }
    const sheet = { ...m.header, ...m.rates };
    await tx.costSheet.upsert({ where: { eventId }, create: { eventId, ...sheet }, update: sheet });
    await audit(tx, actor, {
      eventId, entity: "cost_sheet", entityId: eventId, action: "UPDATE",
      after: { imported: opts.fileName?.slice(0, 200) ?? "planilha", sections: m.sections.length, items: items.length, ...preview.changes, total: Math.round(totals.total * 100) / 100 },
    });
    return { ...preview, saved: true };
  });
}

/** Gera o .xlsx da planilha do evento, no layout da matriz. */
export async function exportCostSheet(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  // Baixar Excel: a Pré-produção e o Cliente com os custos liberados.
  if (!canUsePreProduction(actor, eventId) && !clientCan(actor, eventId, "costs")) throw new NotFoundError("Pré-produção");
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
