import type { Actor } from "../../server/authz/actor";
import { canReviewSla, canUsePreProduction } from "../../server/authz/policy";
import { NotFoundError } from "../../server/errors";
import { requireEventAccess } from "../events/events.service";
import { lineSubtotal } from "../costs/totals";
import { approvedUse, budgetTotals, lineOverrun, lineSaving, type BudgetLine } from "./budget";
import { effectiveCostCenter, itemCode, ITEM_CATEGORIES, COST_CENTERS, type CostCenter, type ItemCategory, type ItemStatus } from "./item-meta";

/**
 * Orçamento do evento com os 4 valores por item e os totais por categoria,
 * por centro de custo e do evento, mais o orçamento aprovado da ficha. Só a
 * Pré-produção vê (o Cliente continua vendo só a planilha que o Gerente
 * libera, e nunca o Realizado). Os valores mudam por updateCostItem.
 */
export async function getBudget(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canUsePreProduction(actor, eventId)) throw new NotFoundError("Pré-produção");
  const data = await actor.run(async (tx) => {
    const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { number: true } });
    const finances = await tx.eventFinances.findUnique({ where: { eventId }, select: { approvedBudget: true } });
    const items = await tx.costItem.findMany({
      where: { eventId },
      orderBy: { number: "asc" },
      select: {
        id: true, number: true, name: true, category: true, costCenter: true, status: true, optional: true,
        unitValue: true, quantity: true, frequency: true, billing: true,
        quotedValue: true, contractedValue: true, actualValue: true,
      },
    });
    // Cotado sozinho: o menor orçamento das cotações do item que não foram canceladas.
    const quotes = await tx.supplierQuote.findMany({
      where: { eventId, request: { costItemId: { not: null }, status: { not: "CANCELADA" } } },
      select: { totalValue: true, request: { select: { costItemId: true } } },
    });
    return { event, finances, items, quotes };
  });

  const lowest = new Map<string, number>();
  for (const q of data.quotes) {
    const id = q.request.costItemId!;
    const v = Number(q.totalValue);
    if (!lowest.has(id) || v < lowest.get(id)!) lowest.set(id, v);
  }
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

  const rows = data.items.map((i) => {
    const category = i.category as ItemCategory | null;
    const fromQuote = lowest.get(i.id);
    const line: BudgetLine = {
      estimated: lineSubtotal({ unitValue: n(i.unitValue), quantity: Number(i.quantity), frequency: n(i.frequency) }),
      quoted: fromQuote ?? n(i.quotedValue),
      contracted: n(i.contractedValue),
      actual: n(i.actualValue),
      optional: i.optional,
    };
    return {
      id: i.id,
      code: itemCode(data.event.number, category, i.number),
      name: i.name,
      category,
      costCenter: effectiveCostCenter(category, i.costCenter as CostCenter | null),
      status: i.status as ItemStatus,
      ...line,
      /** O Cotado veio da cotação (não dá para digitar) ou foi digitado. */
      quotedFrom: fromQuote !== undefined ? ("COTACAO" as const) : i.quotedValue !== null ? ("DIGITADO" as const) : null,
      saving: lineSaving(line),
      overrun: lineOverrun(line),
    };
  });

  const group = <K extends string>(keys: readonly K[], keyOf: (r: (typeof rows)[number]) => K | null) => {
    const out = keys
      .map((k) => ({ key: k as K | null, ...budgetTotals(rows.filter((r) => keyOf(r) === k)) }))
      .filter((g) => g.items > 0);
    const none = rows.filter((r) => keyOf(r) === null);
    const rest = budgetTotals(none);
    return rest.items > 0 ? [...out, { key: null, ...rest }] : out;
  };

  const totals = budgetTotals(rows);
  const approved = n(data.finances?.approvedBudget ?? null);
  return {
    items: rows,
    totals,
    byCategory: group(ITEM_CATEGORIES, (r) => r.category),
    byCostCenter: group(COST_CENTERS, (r) => r.costCenter),
    approved: { value: approved, contractedPct: approvedUse(totals.contracted, approved), left: approved === null ? null : Math.round((approved - totals.contracted) * 100) / 100 },
    can: { director: canReviewSla(actor, eventId) },
  };
}
