import type { Tx } from "../../server/db/with-user";
import { ConflictError } from "../../server/errors";

/**
 * Trava do fechamento financeiro (fase 7B) para as telas que mexem nos
 * valores (planilha, orçamento, cotação, ficha): barra antes do banco, que
 * também barra (migration *_fechamento_financeiro).
 */

export const FINANCIAL_CLOSED_MESSAGE = "O financeiro do evento está fechado. Reabra o fechamento financeiro para mudar valores.";

export async function financialClosed(tx: Tx, eventId: string) {
  const f = await tx.eventFinances.findUnique({ where: { eventId }, select: { financialClosedAt: true } });
  return !!f?.financialClosedAt;
}

export async function assertFinancialOpen(tx: Tx, eventId: string) {
  if (await financialClosed(tx, eventId)) throw new ConflictError(FINANCIAL_CLOSED_MESSAGE);
}

/** Campos do item que travam com o financeiro fechado (os mesmos do banco). */
export const LOCKED_ITEM_FIELDS = [
  "unitValue", "quantity", "frequency", "optional", "billing", "costCenter", "quotedValue",
  "contractedValue", "actualValue", "paidOn", "invoiceNumber", "overrunReason",
] as const;

/** O evento tem valores (contratado ou realizado) e o financeiro ainda não foi fechado? */
export async function financialMissing(tx: Tx, eventId: string) {
  if (await financialClosed(tx, eventId)) return false;
  const n = await tx.costItem.count({ where: { eventId, optional: false, OR: [{ contractedValue: { not: null } }, { actualValue: { not: null } }] } });
  return n > 0;
}

/** Itens que entram no fechamento e quantos ainda impedem fechar (sem realizado, sem pagamento, estouro sem motivo). */
export async function financialState(tx: Tx, eventId: string) {
  const [closed, items] = [
    await financialClosed(tx, eventId),
    await tx.costItem.findMany({
      where: { eventId, optional: false, OR: [{ contractedValue: { not: null } }, { actualValue: { not: null } }] },
      select: { contractedValue: true, actualValue: true, paidOn: true, overrunReason: true },
    }),
  ];
  const pending = items.filter((i) => {
    const c = i.contractedValue === null ? null : Number(i.contractedValue);
    const a = i.actualValue === null ? null : Number(i.actualValue);
    return a === null || !i.paidOn || (c !== null && a > c && !i.overrunReason);
  }).length;
  return { closed, items: items.length, pending };
}
