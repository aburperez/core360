import { z } from "zod";
import type { Actor } from "../../server/authz/actor";
import { audit } from "../../server/audit/audit";
import { ConflictError, NotFoundError, ValidationError } from "../../server/errors";
import { optionalText, parse, text, uuid } from "../../lib/validation";
import { requireEventAccess } from "../events/events.service";
import { canCloseEvent } from "../closure/closure.service";
import { money } from "../costs/costs.service";
import { itemCode, type ItemCategory } from "../items/item-meta";
import { closingTotals, closingLine, type ClosingLine } from "./closing";
import { assertFinancialOpen, financialClosed } from "./lock";

/**
 * Fechamento financeiro (fase 7B): o produtor executivo (Gerente do evento)
 * e o diretor marcam o pagamento de cada item contratado e, no Fechamento,
 * fecham o financeiro. Fechado, os valores do evento travam; reabrir pede um
 * motivo, que fica na auditoria. O evento só vai para Concluído com o
 * financeiro fechado. A migration *_fechamento_financeiro repete as regras.
 */

/** Quem faz: o mesmo de encerrar o evento (Gerente ou Admin de verdade; o Suporte não). */
export const canCloseFinancial = canCloseEvent;

function requireCloser(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canCloseFinancial(actor, eventId)) throw new NotFoundError("Fechamento financeiro");
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export async function getFinancialClosing(actor: Actor, eventId: string) {
  requireCloser(actor, eventId);
  const data = await actor.run(async (tx) => {
    const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { number: true, status: true } });
    const finances = await tx.eventFinances.findUnique({
      where: { eventId },
      select: { financialClosedAt: true, financialCloser: { select: { name: true } } },
    });
    const items = await tx.costItem.findMany({
      where: { eventId },
      orderBy: { number: "asc" },
      select: {
        id: true, number: true, name: true, category: true, optional: true,
        contractedValue: true, actualValue: true, paidOn: true, invoiceNumber: true, overrunReason: true,
      },
    });
    return { event, finances, items };
  });

  const rows = data.items
    .filter((i) => !i.optional && (i.contractedValue !== null || i.actualValue !== null))
    .map((i) => ({
      id: i.id,
      code: itemCode(data.event.number, i.category as ItemCategory | null, i.number),
      name: i.name,
      invoiceNumber: i.invoiceNumber,
      overrunReason: i.overrunReason,
      ...closingLine({ contracted: n(i.contractedValue), actual: n(i.actualValue), paidOn: iso(i.paidOn), overrunReason: i.overrunReason }),
    }));
  const totals = closingTotals(rows);
  const closed = data.finances?.financialClosedAt
    ? { at: data.finances.financialClosedAt, by: data.finances.financialCloser?.name ?? null }
    : null;
  const inStage = data.event.status === "FECHAMENTO";
  return {
    status: data.event.status,
    items: rows,
    totals,
    /** Itens sem contratado nem realizado (não entram) e opcionais. */
    leftOut: data.items.length - rows.length,
    closed,
    can: {
      edit: !closed,
      close: !closed && inStage && totals.pending === 0,
      reopen: !!closed && data.event.status !== "CONCLUIDO",
    },
  };
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida").refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Data inválida");
const paymentSchema = z.object({
  actualValue: money.nullable().optional(),
  /** Pago em; vazio = ainda não pago. */
  paidOn: z.union([z.literal("").transform(() => null), day]).nullable().optional(),
  invoiceNumber: optionalText(60),
  overrunReason: optionalText(500),
});

/** Realizado, pago em, nota fiscal e o motivo do estouro de um item. */
export async function updatePayment(actor: Actor, itemId: string, input: unknown) {
  const data = parse(paymentSchema, input);
  const sent = (input ?? {}) as Record<string, unknown>;
  return actor.run(async (tx) => {
    const i = uuid.safeParse(itemId).success ? await tx.costItem.findUnique({ where: { id: itemId } }) : null;
    if (!i || !canCloseFinancial(actor, i.eventId)) throw new NotFoundError("Item");
    await assertFinancialOpen(tx, i.eventId);

    const before = {
      actualValue: n(i.actualValue), paidOn: iso(i.paidOn), invoiceNumber: i.invoiceNumber, overrunReason: i.overrunReason,
    };
    const next = { ...before };
    for (const k of ["actualValue", "paidOn", "invoiceNumber", "overrunReason"] as const) {
      if (k in sent) (next as Record<string, unknown>)[k] = data[k] ?? null;
    }
    const contracted = n(i.contractedValue);
    if (next.paidOn && next.actualValue === null) {
      throw new ValidationError("Preencha o realizado antes de marcar como pago", { actualValue: ["Quanto foi pago?"] });
    }
    const overrun = contracted !== null && next.actualValue !== null && next.actualValue > contracted;
    if (overrun && !next.overrunReason) {
      throw new ValidationError("O realizado passou do contratado: explique o motivo", { overrunReason: ["Explique por que passou do contratado"] });
    }
    if (!overrun) next.overrunReason = null;

    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== before[k]);
    if (changed.length) {
      await tx.costItem.update({
        where: { id: i.id },
        data: {
          actualValue: next.actualValue,
          paidOn: next.paidOn ? new Date(`${next.paidOn}T00:00:00.000Z`) : null,
          invoiceNumber: next.invoiceNumber,
          overrunReason: next.overrunReason,
        },
      });
      await audit(tx, actor, {
        eventId: i.eventId, entity: "cost_item", entityId: i.id, action: "UPDATE",
        before: Object.fromEntries(changed.map((k) => [k, before[k]])),
        after: Object.fromEntries(changed.map((k) => [k, next[k]])),
      });
    }
    return { id: i.id, ...next };
  });
}

/** Fecha o financeiro: só no Fechamento, com tudo realizado, pago e os estouros explicados. */
export async function closeFinancial(actor: Actor, eventId: string) {
  const c = await getFinancialClosing(actor, eventId);
  if (c.closed) throw new ConflictError("O financeiro já está fechado");
  if (c.status !== "FECHAMENTO") throw new ConflictError("O financeiro fecha com o evento na etapa Fechamento");
  if (c.totals.pending > 0) {
    throw new ConflictError(`Falta${c.totals.pending === 1 ? "" : "m"} ${c.totals.pending} ${c.totals.pending === 1 ? "item" : "itens"}: realizado, pagamento ou motivo do estouro`);
  }
  return actor.run(async (tx) => {
    const now = new Date();
    await tx.eventFinances.upsert({
      where: { eventId },
      create: { eventId, updatedById: actor.userId, financialClosedAt: now, financialClosedBy: actor.userId },
      update: { updatedById: actor.userId, financialClosedAt: now, financialClosedBy: actor.userId },
    });
    await audit(tx, actor, {
      eventId, entity: "event_finances", entityId: eventId, action: "STATUS_CHANGE",
      before: { financial: "ABERTO" },
      after: { financial: "FECHADO", contracted: c.totals.contracted, actual: c.totals.actual, paid: c.totals.paid },
    });
    return { closedAt: now };
  });
}

const reopenSchema = z.object({ reason: text(500).refine((s) => s.length >= 5, "Explique em poucas palavras") });

/** Reabre com um motivo (fica na auditoria). Com o evento Concluído, volte a etapa antes. */
export async function reopenFinancial(actor: Actor, eventId: string, input: unknown) {
  requireCloser(actor, eventId);
  const { reason } = parse(reopenSchema, input);
  return actor.run(async (tx) => {
    const ev = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { status: true } });
    if (!(await financialClosed(tx, eventId))) throw new ConflictError("O financeiro não está fechado");
    if (ev.status === "CONCLUIDO") throw new ConflictError("Volte o evento para Fechamento antes de reabrir o financeiro");
    await tx.eventFinances.update({ where: { eventId }, data: { updatedById: actor.userId, financialClosedAt: null, financialClosedBy: null } });
    await audit(tx, actor, {
      eventId, entity: "event_finances", entityId: eventId, action: "STATUS_CHANGE",
      before: { financial: "FECHADO" }, after: { financial: "ABERTO", reason },
    });
    return { ok: true };
  });
}

/** Para o painel e a Central de pendências: precisa fechar? já fechou? */
export async function financialSummary(actor: Actor, eventId: string) {
  if (!canCloseFinancial(actor, eventId)) return null;
  const c = await getFinancialClosing(actor, eventId);
  return { needed: c.items.length > 0, closed: c.closed, pending: c.totals.pending, toPay: c.totals.toPay, status: c.status, ready: c.can.close };
}

export type { ClosingLine };
