import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client";
import type { Actor } from "../../server/authz/actor";
import { canReviewSla, canUsePreProduction } from "../../server/authz/policy";
import { audit, diff } from "../../server/audit/audit";
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../server/errors";
import { isUniqueViolation } from "../../server/db/errors";
import type { Tx } from "../../server/db/with-user";
import { getStorage } from "../../server/storage/storage";
import { normalizeCnpj } from "../../lib/cnpj";
import { parseDecimal } from "../../lib/money";
import { formatPhone, normalizePhone } from "../../lib/phone";
import { optionalText, parse, text, uuid } from "../../lib/validation";
import { requireEventAccess } from "../events/events.service";
import { resolveSupplier, supplierOptions } from "../suppliers/suppliers.service";
import { sniffImage } from "../attachments/image";
import { AI_READABLE, AiUnavailableError, QUOTE_READER_MODEL, anthropicQuoteReader, quoteReaderEnabled, type AiReadableMime, type QuoteReader } from "./quote-reader";

/**
 * Pré-produção: cotação. O responsável escreve o descritivo (o "briefing" que
 * vai por e-mail aos fornecedores), marca que enviou, o gestor define o prazo
 * para os orçamentos, chegam até 3 orçamentos com os dados do fornecedor e o
 * arquivo, e o gestor escolhe um, com o motivo. Só a Pré-produção entra
 * (canUsePreProduction); prazo, escolha, cancelar e reabrir são do gestor
 * (canReviewSla). A RLS e os gatilhos da migration *_cotacao repetem as regras.
 */

export const MAX_QUOTES = 3;
export const MAX_QUOTE_FILE_BYTES = 10 * 1024 * 1024;

function requirePre(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canUsePreProduction(actor, eventId)) throw new NotFoundError("Pré-produção");
}

function requireManager(actor: Actor, eventId: string, what: string) {
  if (!canReviewSla(actor, eventId)) throw new ForbiddenError(`Só o gestor ${what}`);
}

async function load(actor: Actor, tx: Tx, id: string) {
  const r = uuid.safeParse(id).success ? await tx.quoteRequest.findUnique({ where: { id } }) : null;
  if (!r || !canUsePreProduction(actor, r.eventId)) throw new NotFoundError("Cotação");
  return r;
}

function requireEditable(r: { status: string }) {
  if (r.status === "FECHADA") throw new ConflictError("Cotação fechada. Para mudar, o gestor precisa reabrir.");
  if (r.status === "CANCELADA") throw new ConflictError("Cotação cancelada");
}

const notify = (tx: Tx, requestId: string, kind: "ENVIADA" | "PRAZO" | "RECEBIDOS" | "FECHADA") =>
  tx.$queryRaw`SELECT app.notify_quote(${requestId}::uuid, ${kind})`;

const num = (d: Prisma.Decimal | number | null) => (d === null ? null : Number(d));

/** Situação do prazo, para listas e painel. */
export type QuoteStage = "RASCUNHO" | "SEM_PRAZO" | "NO_PRAZO" | "ATRASADA" | "DECIDIR" | "FECHADA" | "CANCELADA";

export function quoteStage(r: { status: string; dueAt: Date | null; completedAt: Date | null }, now = new Date()): QuoteStage {
  if (r.status === "CANCELADA") return "CANCELADA";
  if (r.status === "FECHADA") return "FECHADA";
  if (r.status === "ABERTA") return "RASCUNHO";
  if (r.completedAt) return "DECIDIR";
  if (!r.dueAt) return "SEM_PRAZO";
  return r.dueAt < now ? "ATRASADA" : "NO_PRAZO";
}

/** Na disputa: tem valor e não foi cancelada. */
export const inDispute = (q: { value: number | null; status: string }) => q.value !== null && q.status !== "CANCELADA";

/** Comparativo das propostas na disputa: menor valor (o negociado, se houver) e a diferença de cada uma para ele. */
export function compareQuotes<Q extends { id: string; value: number | null; status: string }>(all: Q[]) {
  const quotes = all.filter(inDispute) as (Q & { value: number })[];
  if (quotes.length === 0) return { minValue: null, rows: [] as (Q & { value: number; diff: number; diffPct: number | null; lowest: boolean })[] };
  const minValue = Math.min(...quotes.map((q) => q.value));
  return {
    minValue,
    rows: quotes.map((q) => {
      const d = Math.round((q.value - minValue) * 100) / 100;
      return { ...q, diff: d, diffPct: minValue > 0 ? Math.round((d / minValue) * 1000) / 10 : null, lowest: q.value === minValue };
    }),
  };
}

/** Status de uma proposta que volta para a disputa (cotação reaberta ou proposta reativada). */
export function openStatus(q: { totalValue: unknown; negotiatedValue: unknown }) {
  return q.totalValue === null ? ("SOLICITADA" as const) : q.negotiatedValue !== null ? ("EM_NEGOCIACAO" as const) : ("RECEBIDA" as const);
}

/** Quem pode cuidar de uma cotação: Gerente ou Pré-produtor ativo do evento. */
async function pickers(tx: Tx, eventId: string) {
  return tx.participant.findMany({
    where: { eventId, deletedAt: null, active: true, role: { in: ["GERENTE", "PRE_PRODUTOR"] } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  });
}

const requestSelect = {
  id: true, eventId: true, title: true, briefing: true, status: true, responsibleId: true, costItemId: true,
  sentAt: true, slaMinutes: true, dueAt: true, slaSetAt: true, completedAt: true,
  chosenQuoteId: true, chosenReason: true, closedAt: true, createdAt: true, updatedAt: true,
  responsible: { select: { id: true, name: true, role: true, userId: true } },
  costItem: { select: { id: true, name: true, quantity: true, frequency: true, unitValue: true, category: true, section: { select: { name: true } } } },
  slaSetBy: { select: { name: true } },
  closedBy: { select: { name: true } },
  createdBy: { select: { name: true } },
} satisfies Prisma.QuoteRequestSelect;

const quoteSelect = {
  id: true, requestId: true, supplierId: true, position: true, cnpj: true, companyName: true, phone: true, email: true,
  contactName: true, totalValue: true, paymentTerms: true, notes: true, fileName: true, fileMime: true, fileSize: true,
  status: true, negotiatedValue: true, negotiationNote: true, negotiatedAt: true, negotiatedBy: { select: { name: true } },
  createdAt: true, updatedAt: true,
} satisfies Prisma.SupplierQuoteSelect;

type QuoteRow = Prisma.SupplierQuoteGetPayload<{ select: typeof quoteSelect }>;
/** value: o que vale na comparação (o negociado, se houver; senão o recebido). */
const toQuote = ({ totalValue, negotiatedValue, negotiatedBy, ...q }: QuoteRow) => {
  const received = num(totalValue);
  const negotiated = num(negotiatedValue);
  return { ...q, totalValue: received, negotiatedValue: negotiated, negotiatedBy: negotiatedBy?.name ?? null, value: negotiated ?? received, hasFile: !!q.fileName };
};

/** Lista do evento, com o que a tela de nova cotação precisa. */
export async function listQuotes(actor: Actor, eventId: string, now = new Date()) {
  requirePre(actor, eventId);
  return actor.run(async (tx) => {
    const [rows, people, items] = await Promise.all([
      tx.quoteRequest.findMany({
        where: { eventId },
        orderBy: [{ createdAt: "desc" }],
        select: { ...requestSelect, quotes: { select: { totalValue: true, negotiatedValue: true, status: true } } },
      }),
      pickers(tx, eventId),
      tx.costItem.findMany({
        where: { eventId },
        orderBy: [{ section: { position: "asc" } }, { position: "asc" }],
        select: { id: true, name: true, section: { select: { name: true } } },
      }),
    ]);
    const me = actor.memberships.find((m) => m.eventId === eventId)?.participantId ?? null;
    return {
      items: rows.map(({ quotes, costItem, ...r }) => ({
        ...r,
        costItemName: costItem ? `${costItem.section.name} › ${costItem.name}` : null,
        count: quotes.length,
        minValue: compareQuotes(quotes.map((q, i) => ({ id: String(i), status: q.status, value: num(q.negotiatedValue) ?? num(q.totalValue) }))).minValue,
        stage: quoteStage(r, now),
        mine: !!me && r.responsibleId === me,
      })),
      people,
      costItems: items.map((i) => ({ id: i.id, label: `${i.section.name} › ${i.name}` })),
      me,
      can: { create: true, manage: canReviewSla(actor, eventId) },
    };
  });
}

/** Contagem para o painel da pré-produção. */
export async function quotesSummary(actor: Actor, eventId: string, now = new Date()) {
  requirePre(actor, eventId);
  const rows = await actor.run((tx) =>
    tx.quoteRequest.findMany({ where: { eventId }, select: { status: true, dueAt: true, completedAt: true } }),
  );
  const count = (s: QuoteStage) => rows.filter((r) => quoteStage(r, now) === s).length;
  return {
    total: rows.filter((r) => r.status !== "CANCELADA").length,
    closed: count("FECHADA"),
    draft: count("RASCUNHO"),
    noDeadline: count("SEM_PRAZO"),
    late: count("ATRASADA"),
    toDecide: count("DECIDIR"),
  };
}

/** Detalhe: pedido, orçamentos, comparativo e o que a pessoa pode fazer. */
export async function getQuote(actor: Actor, id: string, now = new Date()) {
  return actor.run(async (tx) => {
    const base = await load(actor, tx, id);
    const [r, quotes, people, items] = await Promise.all([
      tx.quoteRequest.findUniqueOrThrow({ where: { id: base.id }, select: requestSelect }),
      tx.supplierQuote.findMany({ where: { requestId: base.id }, orderBy: { position: "asc" }, select: quoteSelect }),
      pickers(tx, base.eventId),
      tx.costItem.findMany({
        where: { eventId: base.eventId },
        orderBy: [{ section: { position: "asc" } }, { position: "asc" }],
        select: { id: true, name: true, section: { select: { name: true } } },
      }),
    ]);
    const event = await tx.event.findUniqueOrThrow({ where: { id: base.eventId }, select: { name: true } });
    const list = quotes.map(toQuote);
    const editable = r.status === "ABERTA" || r.status === "ENVIADA";
    // O formulário do orçamento escolhe do cadastro (os da categoria do item primeiro).
    const suppliers = editable ? await supplierOptions(tx, base.eventId, r.costItem?.category ?? null) : [];
    const manager = canReviewSla(actor, base.eventId);
    const { costItem, ...rest } = r;
    return {
      ...rest,
      eventName: event.name,
      stage: quoteStage(r, now),
      costItem: costItem && {
        id: costItem.id, label: `${costItem.section.name} › ${costItem.name}`,
        quantity: Number(costItem.quantity), frequency: num(costItem.frequency), unitValue: num(costItem.unitValue),
      },
      quotes: list,
      comparison: compareQuotes(list),
      suppliers,
      aiReader: editable && quoteReaderEnabled(),
      people,
      costItems: items.map((i) => ({ id: i.id, label: `${i.section.name} › ${i.name}` })),
      can: {
        manage: manager,
        edit: editable,
        send: r.status === "ABERTA",
        addQuote: editable && list.length < MAX_QUOTES,
        setSla: manager && r.status === "ENVIADA",
        choose: manager && editable && list.length > 0,
        cancel: manager && editable,
        reopen: manager && (r.status === "FECHADA" || r.status === "CANCELADA"),
      },
    };
  });
}

const requestSchema = z.object({
  title: text(120),
  briefing: text(5000),
  responsibleId: uuid,
  costItemId: uuid.optional().nullable(),
});

async function checkLinks(tx: Tx, eventId: string, data: { responsibleId?: string; costItemId?: string | null }) {
  if (data.responsibleId) {
    const ok = (await pickers(tx, eventId)).some((p) => p.id === data.responsibleId);
    if (!ok) throw new ValidationError("Escolha um Gerente ou Pré-produtor do evento para cuidar da cotação");
  }
  if (data.costItemId) {
    const item = await tx.costItem.findFirst({ where: { id: data.costItemId, eventId }, select: { id: true } });
    if (!item) throw new ValidationError("Item da planilha não encontrado neste evento");
  }
}

/** Novo pedido de cotação. O evento vem da URL e é conferido; responsável e item são do mesmo evento. */
export async function createQuote(actor: Actor, eventId: string, input: unknown) {
  requirePre(actor, eventId);
  const data = parse(requestSchema, input);
  return actor.run(async (tx) => {
    await checkLinks(tx, eventId, data);
    const r = await tx.quoteRequest.create({
      data: {
        eventId, title: data.title, briefing: data.briefing, responsibleId: data.responsibleId,
        costItemId: data.costItemId ?? null, createdById: actor.userId,
      },
    });
    await audit(tx, actor, {
      eventId, entity: "quote_request", entityId: r.id, action: "CREATE",
      after: { title: r.title, responsibleId: r.responsibleId, costItemId: r.costItemId },
    });
    return { id: r.id };
  });
}

const updateSchema = requestSchema.partial();

export async function updateQuote(actor: Actor, id: string, input: unknown) {
  const data = parse(updateSchema, input);
  const sent = (input ?? {}) as Record<string, unknown>;
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => k in sent));
  return actor.run(async (tx) => {
    const r = await load(actor, tx, id);
    requireEditable(r);
    await checkLinks(tx, r.eventId, patch as { responsibleId?: string; costItemId?: string | null });
    if (!Object.keys(patch).length) return { id: r.id };
    await tx.quoteRequest.update({ where: { id: r.id }, data: patch });
    await audit(tx, actor, { eventId: r.eventId, entity: "quote_request", entityId: r.id, action: "UPDATE", ...diff(r as Record<string, unknown>, patch) });
    return { id: r.id };
  });
}

/** Até 90 dias, em minutos. */
const minutes = z.coerce.number().int("Use minutos inteiros").min(1, "Mínimo 1 minuto").max(129600, "Máximo 90 dias");

async function applySla(tx: Tx, actor: Actor, r: { id: string; eventId: string }, value: number) {
  const now = new Date();
  const dueAt = new Date(now.getTime() + value * 60_000);
  await tx.quoteRequest.update({
    where: { id: r.id },
    data: { slaMinutes: value, dueAt, slaSetAt: now, slaSetById: actor.userId },
  });
  await audit(tx, actor, { eventId: r.eventId, entity: "quote_request", entityId: r.id, action: "UPDATE", after: { slaMinutes: value, dueAt } });
  await notify(tx, r.id, "PRAZO");
}

const sendSchema = z.object({ slaMinutes: minutes.optional().nullable() });

/**
 * O responsável marca que mandou o descritivo aos fornecedores. O gestor é
 * avisado para definir o prazo; se quem marca já é o gestor, pode definir junto.
 */
export async function markQuoteSent(actor: Actor, id: string, input: unknown = {}) {
  const data = parse(sendSchema, input ?? {});
  return actor.run(async (tx) => {
    const r = await load(actor, tx, id);
    if (r.status !== "ABERTA") throw new ConflictError("Esta cotação já foi enviada");
    if (data.slaMinutes) requireManager(actor, r.eventId, "define o prazo da cotação");
    const done = await tx.quoteRequest.updateMany({
      where: { id: r.id, status: "ABERTA" },
      data: { status: "ENVIADA", sentAt: new Date(), sentById: actor.userId },
    });
    if (done.count === 0) throw new ConflictError("Esta cotação já foi enviada");
    await audit(tx, actor, { eventId: r.eventId, entity: "quote_request", entityId: r.id, action: "UPDATE", before: { status: r.status }, after: { status: "ENVIADA" } });
    await notify(tx, r.id, "ENVIADA");
    if (data.slaMinutes) await applySla(tx, actor, r, data.slaMinutes);
    return { id: r.id };
  });
}

/** O gestor define (ou muda) o prazo para chegarem os orçamentos, contado a partir de agora. */
export async function setQuoteSla(actor: Actor, id: string, input: unknown) {
  const { slaMinutes } = parse(z.object({ slaMinutes: minutes }), input);
  return actor.run(async (tx) => {
    const r = await load(actor, tx, id);
    requireManager(actor, r.eventId, "define o prazo da cotação");
    if (r.status !== "ENVIADA") throw new ConflictError("O prazo vale depois do envio aos fornecedores");
    await applySla(tx, actor, r, slaMinutes);
    return { id: r.id };
  });
}

// ─────────────────────────── Orçamentos ───────────────────────────

/** Número ou texto no jeito brasileiro ("27.500,00"). */
const money = z
  .preprocess(
    (v) => (typeof v === "string" ? (parseDecimal(v) ?? v) : v),
    z.number({ message: "Informe o valor" }).min(0, "Valor inválido").max(999_999_999_999, "Valor muito alto"),
  )
  .transform((v) => Math.round(v * 100) / 100);

const quoteSchema = z.object({
  cnpj: z.string().trim().transform((v, ctx) => {
    const n = normalizeCnpj(v);
    if (!n) ctx.addIssue({ code: "custom", message: "CNPJ inválido" });
    return n ?? "";
  }),
  companyName: text(160),
  phone: z.string().trim().max(30).transform((v, ctx) => {
    const n = normalizePhone(v);
    if (!n) ctx.addIssue({ code: "custom", message: "Telefone inválido. Use DDD + número" });
    return n ?? "";
  }),
  email: z.string().trim().max(160).pipe(z.email({ message: "E-mail inválido" })),
  contactName: text(120),
  /** Vazio = proposta Solicitada (ainda sem valor). */
  totalValue: z.preprocess((v) => (v === "" || v === undefined ? null : v), money.nullable()),
  paymentTerms: optionalText(300),
  notes: optionalText(2000),
});

export interface QuoteFile {
  bytes: Uint8Array;
  name: string;
}

/** Arquivo do orçamento: PDF, foto, Excel ou Word, conferido pelos bytes. */
export function sniffQuoteFile(bytes: Uint8Array, name: string): { mime: string; ext: string } | null {
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-") return { mime: "application/pdf", ext: "pdf" };
  const image = sniffImage(bytes);
  if (image) return image;
  const zip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  const ext = name.toLowerCase().split(".").pop();
  if (zip && ext === "xlsx") return { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext };
  if (zip && ext === "docx") return { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext };
  return null;
}

function checkFile(file: QuoteFile) {
  if (file.bytes.length === 0) throw new ValidationError("Arquivo vazio");
  if (file.bytes.length > MAX_QUOTE_FILE_BYTES) throw new ValidationError("Arquivo maior que 10 MB");
  const kind = sniffQuoteFile(file.bytes, file.name);
  if (!kind) throw new ValidationError("Envie o orçamento em PDF, foto, Excel (.xlsx) ou Word (.docx)");
  const name = file.name.replace(/[\\/\r\n"]/g, "_").trim().slice(0, 160) || `orcamento.${kind.ext}`;
  return { ...kind, name };
}

/** Leituras pela IA por pessoa, por hora (cada uma custa). */
export const MAX_AI_READS_PER_HOUR = 20;

const clip = (v: string | null, max: number) => (v ? v.replace(/\s+/g, " ").trim().slice(0, max) || null : null);
const clipLines = (v: string | null, max: number) => (v ? v.trim().slice(0, max) || null : null);

/**
 * A IA lê o arquivo do orçamento (PDF ou foto) e devolve os campos para o
 * formulário. NADA é salvo aqui: quem anexou confere e clica em "Confirmar e
 * adicionar", que é o addSupplierQuote normal, com as mesmas validações. Só
 * fica o registro da leitura no histórico (quem, quando, arquivo, custo).
 */
export async function readQuoteWithAi(actor: Actor, requestId: string, file: QuoteFile | null, reader: QuoteReader = anthropicQuoteReader) {
  if (!file) throw new ValidationError("Anexe o arquivo do orçamento");
  const kind = checkFile(file);
  if (!(AI_READABLE as readonly string[]).includes(kind.mime)) {
    throw new ValidationError(kind.mime === "image/heic"
      ? "Foto em HEIC: a IA não lê esse formato. Envie em JPG ou PNG, ou preencha à mão."
      : "A IA lê PDF e foto. Excel e Word você preenche à mão.");
  }
  if (kind.mime.startsWith("image/") && file.bytes.length > 5 * 1024 * 1024) throw new ValidationError("Foto maior que 5 MB: a IA não lê. Envie uma foto menor ou preencha à mão.");
  const ctx = await actor.run(async (tx) => {
    const r = await load(actor, tx, requestId);
    requireEditable(r);
    if (await tx.supplierQuote.count({ where: { requestId: r.id } }) >= MAX_QUOTES) {
      throw new ValidationError(`A cotação já tem ${MAX_QUOTES} orçamentos. Edite ou remova um deles.`);
    }
    const reads = await tx.auditLog.count({
      where: { actorUserId: actor.userId, entity: "quote_reading", occurredAt: { gte: new Date(Date.now() - 3_600_000) } },
    });
    if (reads >= MAX_AI_READS_PER_HOUR) throw new AppError("Limite de leituras pela IA nesta hora. Preencha à mão ou tente mais tarde.", 429, "AI_LIMIT");
    const event = await tx.event.findUniqueOrThrow({ where: { id: r.eventId }, select: { name: true, agencyId: true } });
    return { r, event };
  });
  if (reader === anthropicQuoteReader && !quoteReaderEnabled()) throw new AiUnavailableError();

  const read = await reader({ bytes: file.bytes, mime: kind.mime as AiReadableMime }, { eventName: ctx.event.name, itemTitle: ctx.r.title });

  const warnings: string[] = [];
  if (!read.isQuote) warnings.push("O arquivo não parece um orçamento. Confira cada campo com cuidado.");
  const rawCnpj = (read.cnpj ?? "").replace(/\D/g, "").slice(0, 14);
  const cnpj = normalizeCnpj(rawCnpj);
  if (!rawCnpj) warnings.push("Não encontrei o CNPJ do fornecedor.");
  else if (!cnpj) warnings.push("O CNPJ lido não confere. Confira no arquivo.");
  const phone = read.phone ? normalizePhone(read.phone) : null;
  if (!read.phone) warnings.push("Não encontrei o telefone.");
  else if (!phone) warnings.push("O telefone lido não parece válido. Confira o DDD.");
  const email = clip(read.email, 160);
  if (!email) warnings.push("Não encontrei o e-mail.");
  else if (!z.email().safeParse(email).success) warnings.push("O e-mail lido não parece válido.");
  if (!read.contactName) warnings.push("Não encontrei o nome do responsável.");
  const totalValue = read.totalValue !== null && read.totalValue >= 0 && read.totalValue < 1e12 ? Math.round(read.totalValue * 100) / 100 : null;
  if (totalValue === null) warnings.push("Não encontrei o valor total. Confira no arquivo.");

  // Fornecedor já no cadastro da agência: o formulário usa o do cadastro.
  const supplier = cnpj
    ? await actor.run((tx) => tx.supplier.findUnique({
      where: { agencyId_cnpj: { agencyId: ctx.event.agencyId, cnpj } }, select: { id: true, companyName: true, archivedAt: true },
    }))
    : null;
  if (supplier?.archivedAt) warnings.push(`${supplier.companyName} está arquivado no cadastro. Peça ao diretor para reativar antes de adicionar.`);

  await actor.run((tx) => audit(tx, actor, {
    eventId: ctx.r.eventId, entity: "quote_reading", entityId: ctx.r.id, action: "CREATE",
    after: { fileName: kind.name, mime: kind.mime, size: file.bytes.length, model: QUOTE_READER_MODEL, inputTokens: read.usage.input, outputTokens: read.usage.output, isQuote: read.isQuote },
  }));

  return {
    fields: {
      cnpj: cnpj ?? rawCnpj,
      companyName: clip(read.companyName, 160),
      tradeName: clip(read.tradeName, 160),
      contactName: clip(read.contactName, 120),
      phone: phone ? formatPhone(phone) : clip(read.phone, 30),
      email,
      totalValue,
      paymentTerms: clip(read.paymentTerms, 300),
      notes: clipLines(read.notes, 2000),
    },
    supplierId: supplier && !supplier.archivedAt ? supplier.id : null,
    warnings,
  };
}

/** Grava o arquivo antes do registro (fora do banco) ou na mesma transação (no banco). */
async function storeFile(eventId: string, requestId: string, file: QuoteFile) {
  const kind = checkFile(file);
  const sha = createHash("sha256").update(file.bytes).digest("hex").slice(0, 16);
  const key = `events/${eventId}/quotes/${requestId}/${randomUUID()}-${sha}.${kind.ext}`;
  const storage = getStorage();
  if (!storage.inDatabase) await storage.put(key, file.bytes, kind.mime);
  return {
    key, mime: kind.mime, name: kind.name, size: file.bytes.length,
    save: (tx: Tx) => (storage.inDatabase ? storage.put(key, file.bytes, kind.mime, tx) : Promise.resolve()),
  };
}

/** Chegou ao terceiro orçamento (ou deixou de ter três): marca e avisa o gestor. */
async function syncCompleted(tx: Tx, r: { id: string; completedAt: Date | null }) {
  // Conta as propostas que chegaram com valor e seguem na disputa.
  const n = await tx.supplierQuote.count({ where: { requestId: r.id, totalValue: { not: null }, status: { not: "CANCELADA" } } });
  if (n >= MAX_QUOTES && !r.completedAt) {
    await tx.quoteRequest.update({ where: { id: r.id }, data: { completedAt: new Date() } });
    await notify(tx, r.id, "RECEBIDOS");
  } else if (n < MAX_QUOTES && r.completedAt) {
    await tx.quoteRequest.update({ where: { id: r.id }, data: { completedAt: null } });
  }
}

const auditQuote = (q: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(q).filter(([k]) => !k.startsWith("file")).map(([k, v]) => [k, v !== null && typeof v === "object" && !(v instanceof Date) ? Number(v) : v]));

/** Novo orçamento (até 3 por cotação), com o arquivo recebido opcional. Sem valor, entra como Solicitada. */
export async function addSupplierQuote(actor: Actor, requestId: string, input: unknown, file?: QuoteFile | null) {
  const data = parse(quoteSchema, input);
  const pre = await actor.run((tx) => load(actor, tx, requestId));
  requireEditable(pre);
  const stored = file ? await storeFile(pre.eventId, pre.id, file) : null;
  try {
    return await actor.run(async (tx) => {
      const r = await load(actor, tx, requestId);
      requireEditable(r);
      const used = (await tx.supplierQuote.findMany({ where: { requestId: r.id }, select: { position: true } })).map((q) => q.position);
      const position = [1, 2, 3].find((p) => !used.includes(p));
      if (!position) throw new ValidationError(`A cotação já tem ${MAX_QUOTES} orçamentos. Edite ou remova um deles.`);
      if (stored) await stored.save(tx);
      const supplier = await resolveSupplier(tx, actor, r.eventId, data);
      const q = await tx.supplierQuote.create({
        data: {
          ...data, supplierId: supplier.id, eventId: r.eventId, requestId: r.id, position, createdById: actor.userId,
          status: data.totalValue === null ? "SOLICITADA" : "RECEBIDA",
          ...(stored && { fileKey: stored.key, fileName: stored.name, fileMime: stored.mime, fileSize: stored.size }),
        },
        select: quoteSelect,
      });
      await audit(tx, actor, { eventId: r.eventId, entity: "supplier_quote", entityId: q.id, action: "CREATE", after: auditQuote({ ...data, requestId: r.id, file: !!stored }) });
      await syncCompleted(tx, r);
      return { ...toQuote(q), newSupplier: supplier.created };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError("Outra pessoa acabou de registrar um orçamento. Atualize a tela e tente de novo.");
    throw e;
  }
}

async function loadQuote(actor: Actor, tx: Tx, quoteId: string) {
  const q = uuid.safeParse(quoteId).success ? await tx.supplierQuote.findUnique({ where: { id: quoteId } }) : null;
  if (!q || !canUsePreProduction(actor, q.eventId)) throw new NotFoundError("Orçamento");
  return q;
}

/** Corrige os dados do orçamento e, se vier, troca o arquivo. */
export async function updateSupplierQuote(actor: Actor, quoteId: string, input: unknown, file?: QuoteFile | null) {
  const data = parse(quoteSchema.partial(), input);
  const sent = (input ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = Object.fromEntries(Object.entries(data).filter(([k]) => k in sent));
  const pre = await actor.run(async (tx) => {
    const q = await loadQuote(actor, tx, quoteId);
    requireEditable(await load(actor, tx, q.requestId));
    return q;
  });
  const stored = file ? await storeFile(pre.eventId, pre.requestId, file) : null;
  return actor.run(async (tx) => {
    const q = await loadQuote(actor, tx, quoteId);
    const r = await load(actor, tx, q.requestId);
    requireEditable(r);
    if ("totalValue" in patch) {
      if (patch.totalValue === null && q.totalValue !== null) throw new ValidationError("Informe o valor recebido", { totalValue: ["Informe o valor"] });
      const changed = patch.totalValue !== num(q.totalValue);
      if (changed && q.negotiatedValue !== null) requireManager(actor, q.eventId, "corrige o valor recebido depois da negociação");
      // Chegou o valor de uma proposta Solicitada.
      if (q.status === "SOLICITADA" && patch.totalValue !== null) patch.status = "RECEBIDA";
      if (!changed) delete patch.totalValue;
    }
    if (stored) {
      await stored.save(tx);
      Object.assign(patch, { fileKey: stored.key, fileName: stored.name, fileMime: stored.mime, fileSize: stored.size });
    }
    if (!Object.keys(patch).length) return toQuote(await tx.supplierQuote.findUniqueOrThrow({ where: { id: q.id }, select: quoteSelect }));
    // Outro CNPJ é outro fornecedor: aponta para o do cadastro (ou um novo).
    if (typeof patch.cnpj === "string" && patch.cnpj !== q.cnpj) {
      const s = await resolveSupplier(tx, actor, q.eventId, {
        cnpj: patch.cnpj, companyName: String(patch.companyName ?? q.companyName), contactName: String(patch.contactName ?? q.contactName),
        phone: String(patch.phone ?? q.phone), email: String(patch.email ?? q.email),
      });
      patch.supplierId = s.id;
    }
    const updated = await tx.supplierQuote.update({ where: { id: q.id }, data: patch, select: quoteSelect });
    await audit(tx, actor, {
      eventId: q.eventId, entity: "supplier_quote", entityId: q.id, action: "UPDATE",
      ...diff(auditQuote(q), auditQuote({ ...patch, ...(stored && { file: true }) })),
    });
    await syncCompleted(tx, r);
    return toQuote(updated);
  });
}

export async function deleteSupplierQuote(actor: Actor, quoteId: string) {
  return actor.run(async (tx) => {
    const q = await loadQuote(actor, tx, quoteId);
    const r = await load(actor, tx, q.requestId);
    requireEditable(r);
    await tx.supplierQuote.delete({ where: { id: q.id } });
    await audit(tx, actor, { eventId: q.eventId, entity: "supplier_quote", entityId: q.id, action: "DELETE", before: auditQuote(q) });
    await syncCompleted(tx, r);
    return { ok: true };
  });
}

/** Bytes (arquivos no banco/memória) ou link assinado (R2), sempre depois de conferir o acesso. */
/**
 * Andamento da proposta pela Pré-produção: Em negociação, Cancelada (o
 * fornecedor desistiu) ou Reativar. Aprovada e Recusada só pela escolha do
 * diretor; Solicitada e Recebida seguem o valor (ver updateSupplierQuote).
 */
export async function setProposalStatus(actor: Actor, quoteId: string, input: unknown) {
  const { action } = parse(z.object({ action: z.enum(["NEGOCIACAO", "CANCELAR", "REATIVAR"]) }), input);
  return actor.run(async (tx) => {
    const q = await loadQuote(actor, tx, quoteId);
    const r = await load(actor, tx, q.requestId);
    requireEditable(r);
    const status = action === "NEGOCIACAO" ? "EM_NEGOCIACAO" : action === "CANCELAR" ? "CANCELADA" : openStatus(q);
    const allowed = action === "NEGOCIACAO" ? q.status === "RECEBIDA"
      : action === "CANCELAR" ? q.status !== "CANCELADA" : q.status === "CANCELADA";
    if (!allowed) throw new ConflictError("A proposta já mudou. Atualize a tela.");
    const updated = await tx.supplierQuote.update({ where: { id: q.id }, data: { status }, select: quoteSelect });
    await audit(tx, actor, {
      eventId: q.eventId, entity: "supplier_quote", entityId: q.id, action: "STATUS_CHANGE", before: { status: q.status }, after: { status },
    });
    await syncCompleted(tx, r);
    return toQuote(updated);
  });
}

const negotiateSchema = z.object({
  /** Vazio desfaz a negociação (volta a valer o valor recebido). */
  value: z.preprocess((v) => (v === "" || v === undefined ? null : v), money.nullable()),
  note: optionalText(500),
});

/** O diretor registra o valor negociado. O valor recebido fica guardado e aparece riscado. */
export async function negotiateProposal(actor: Actor, quoteId: string, input: unknown) {
  const data = parse(negotiateSchema, input);
  return actor.run(async (tx) => {
    const q = await loadQuote(actor, tx, quoteId);
    const r = await load(actor, tx, q.requestId);
    requireManager(actor, q.eventId, "negocia o valor da proposta");
    requireEditable(r);
    if (q.totalValue === null) throw new ValidationError("Registre primeiro o valor recebido do fornecedor");
    if (q.status === "CANCELADA") throw new ConflictError("Proposta cancelada. Reative antes de negociar.");
    const patch = data.value === null
      ? { negotiatedValue: null, negotiationNote: null, negotiatedAt: null, negotiatedById: null }
      : { negotiatedValue: data.value, negotiationNote: data.note, negotiatedAt: new Date(), negotiatedById: actor.userId, status: "EM_NEGOCIACAO" as const };
    const updated = await tx.supplierQuote.update({ where: { id: q.id }, data: patch, select: quoteSelect });
    await audit(tx, actor, {
      eventId: q.eventId, entity: "supplier_quote", entityId: q.id, action: "UPDATE",
      before: { totalValue: num(q.totalValue), negotiatedValue: num(q.negotiatedValue), status: q.status },
      after: { negotiatedValue: data.value, note: data.note, status: updated.status },
    });
    return toQuote(updated);
  });
}

export async function quoteFile(actor: Actor, quoteId: string) {
  const q = await actor.run((tx) => loadQuote(actor, tx, quoteId));
  if (!q.fileKey || !q.fileMime || !q.fileName) throw new NotFoundError("Arquivo");
  const storage = getStorage();
  const key = q.fileKey;
  if (storage.get) {
    const get = storage.get.bind(storage);
    const body = storage.inDatabase ? await actor.run((tx) => get(key, tx)) : await get(key);
    if (!body) throw new NotFoundError("Arquivo");
    return { body, mimeType: q.fileMime, fileName: q.fileName, url: null };
  }
  return { body: null, mimeType: q.fileMime, fileName: q.fileName, url: await storage.signedUrl(key) };
}

// ─────────────────────────── Decisão do gestor ───────────────────────────

const chooseSchema = z.object({
  quoteId: uuid,
  reason: optionalText(1000),
  /** Leva o valor escolhido para o Contratado do item ligado. */
  applyToCost: z.boolean().optional(),
});

/** Valor unitário que faz o subtotal do item (unitário × qtd × freq) bater com o orçamento. */
export function unitValueFor(total: number, quantity: number, frequency: number | null) {
  const units = quantity * (frequency ?? 1);
  return units > 0 ? Math.round((total / units) * 100) / 100 : null;
}

/**
 * O gestor escolhe o orçamento. Escolher um que não é o mais barato pede o
 * motivo. Se a cotação está ligada a um item, o valor pode virar o Contratado.
 */
export async function chooseQuote(actor: Actor, id: string, input: unknown) {
  const data = parse(chooseSchema, input);
  return actor.run(async (tx) => {
    const r = await load(actor, tx, id);
    requireManager(actor, r.eventId, "escolhe o orçamento");
    requireEditable(r);
    const all = await tx.supplierQuote.findMany({ where: { requestId: r.id }, select: { id: true, totalValue: true, negotiatedValue: true, status: true } });
    const { rows, minValue } = compareQuotes(all.map((q) => ({ id: q.id, status: q.status, value: num(q.negotiatedValue) ?? num(q.totalValue) })));
    if (!all.some((q) => q.id === data.quoteId)) throw new NotFoundError("Orçamento");
    const chosen = rows.find((q) => q.id === data.quoteId);
    if (!chosen) throw new ValidationError("Escolha uma proposta com valor que não foi cancelada");
    if (chosen.value > minValue! && !data.reason) {
      throw new ValidationError("Explique por que escolheu um orçamento que não é o de menor valor", { reason: ["Explique a escolha"] });
    }
    const now = new Date();
    await tx.quoteRequest.update({
      where: { id: r.id },
      data: {
        status: "FECHADA", chosenQuoteId: chosen.id, chosenReason: data.reason, closedAt: now, closedById: actor.userId,
        // Fechada sem ter sido marcada como enviada (ex.: orçamentos que já estavam em mãos).
        ...(!r.sentAt && { sentAt: now, sentById: actor.userId }),
      },
    });
    await audit(tx, actor, {
      eventId: r.eventId, entity: "quote_request", entityId: r.id, action: "VALIDATE",
      before: { status: r.status }, after: { status: "FECHADA", chosenQuoteId: chosen.id, reason: data.reason },
    });
    // A escolhida fica Aprovada; as outras que seguiam na disputa (ou nem chegaram), Recusadas.
    await tx.supplierQuote.update({ where: { id: chosen.id }, data: { status: "APROVADA" } });
    await tx.supplierQuote.updateMany({ where: { requestId: r.id, id: { not: chosen.id }, status: { not: "CANCELADA" } }, data: { status: "RECUSADA" } });

    // O valor escolhido vira o Contratado do item (o Estimado fica guardado
    // para comparar). Contratado preenchido põe o item em Contratado (banco).
    let applied: { contractedValue: number } | null = null;
    if (data.applyToCost && r.costItemId) {
      const item = await tx.costItem.findFirst({ where: { id: r.costItemId, eventId: r.eventId } });
      if (!item) throw new NotFoundError("Item");
      const value = chosen.value;
      await tx.costItem.update({ where: { id: item.id }, data: { contractedValue: value } });
      await audit(tx, actor, {
        eventId: r.eventId, entity: "cost_item", entityId: item.id, action: "UPDATE",
        before: { contractedValue: num(item.contractedValue) }, after: { contractedValue: value, fromQuote: r.id },
      });
      applied = { contractedValue: value };
    }
    await notify(tx, r.id, "FECHADA");
    return { id: r.id, applied };
  });
}

/** Cancela (some das pendências) ou reabre (volta para receber orçamentos). Só o gestor. */
export async function setQuoteState(actor: Actor, id: string, input: unknown) {
  const { action } = parse(z.object({ action: z.enum(["CANCELAR", "REABRIR"]) }), input);
  return actor.run(async (tx) => {
    const r = await load(actor, tx, id);
    requireManager(actor, r.eventId, action === "CANCELAR" ? "cancela a cotação" : "reabre a cotação");
    if (action === "CANCELAR") requireEditable(r);
    else if (r.status !== "FECHADA" && r.status !== "CANCELADA") throw new ConflictError("Esta cotação já está aberta");
    if (action === "REABRIR" && await tx.contractItem.count({ where: { quote: { requestId: r.id }, contract: { status: { not: "CANCELADO" } } } })) {
      throw new ConflictError("A proposta escolhida está num contrato. O diretor precisa cancelar o contrato antes de reabrir a cotação.");
    }
    const status = action === "CANCELAR" ? "CANCELADA" : r.sentAt ? "ENVIADA" : "ABERTA";
    await tx.quoteRequest.update({
      where: { id: r.id },
      data: { status, chosenQuoteId: null, chosenReason: null, closedAt: null, closedById: null },
    });
    // Reaberta: Aprovada e Recusadas voltam para a disputa.
    if (action === "REABRIR") {
      const closed = await tx.supplierQuote.findMany({ where: { requestId: r.id, status: { in: ["APROVADA", "RECUSADA"] } } });
      for (const q of closed) await tx.supplierQuote.update({ where: { id: q.id }, data: { status: openStatus(q) } });
    }
    await audit(tx, actor, { eventId: r.eventId, entity: "quote_request", entityId: r.id, action: "UPDATE", before: { status: r.status }, after: { status } });
    return { id: r.id, status };
  });
}
