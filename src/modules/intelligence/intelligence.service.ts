import type { Actor } from "../../server/authz/actor";
import { canReviewSla } from "../../server/authz/policy";
import { NotFoundError } from "../../server/errors";
import type { Tx } from "../../server/db/with-user";
import { uuid } from "../../lib/validation";
import { requireEventAccess } from "../events/events.service";
import { resolveAgency } from "../clients/clients.service";
import type { ClosureSummary } from "../closure/closure.service";
import { lineSubtotal } from "../costs/totals";
import { budgetTotals, type BudgetLine, type BudgetTotals } from "../items/budget";
import { ITEM_CATEGORIES, itemCode, type ItemCategory } from "../items/item-meta";
import { ratingSummaries, type RatingSummary } from "../suppliers/ratings.service";
import { itemCost, matchScore, matchesQuery, perPerson, spread, unitPrice, words } from "./intelligence";

/**
 * Inteligência da agência (fase 7C): ranking de fornecedores pelas notas,
 * banco de preços dos itens de todos os eventos (os guardados no app e o
 * resumo dos encerrados) e o comparativo entre eventos. A tela é do diretor
 * de produção (Admin da agência; o Suporte só olha); dentro de uma cotação,
 * o Gerente do evento vê os preços dos outros eventos. O banco repete a regra
 * (migration *_inteligencia): os preços de outros eventos só saem para o
 * Admin da agência e para quem é Gerente de um evento dela.
 */

export type PriceRow = BudgetLine & {
  eventId: string;
  eventName: string;
  client: string;
  startsAt: Date;
  /** Encerrado e excluído: o item vem do resumo guardado. */
  archived: boolean;
  code: string;
  name: string;
  category: ItemCategory | null;
  quantity: number;
  unit: string | null;
  supplier: string | null;
};

type EventRow = {
  event_id: string; number: number; name: string; client_name: string; starts_at: Date; ends_at: Date;
  timezone: string; status: string; audience: number | null; archived: boolean;
};
type ItemRow = {
  event_id: string; item_number: number; name: string; category: string | null; quantity: string; unit: string | null;
  frequency: string | null; unit_value: string | null; optional: boolean; quoted_value: string | null; lowest_quote: string | null;
  contracted_value: string | null; actual_value: string | null; supplier: string | null;
};

const n = (v: string | number | null | undefined) => (v === null || v === undefined ? null : Number(v));
const isCategory = (c: string | null | undefined): c is ItemCategory => (ITEM_CATEGORIES as readonly string[]).includes(c ?? "");

/** Os eventos da agência e todos os itens com os 4 valores (os encerrados, pelo resumo). */
async function loadAgency(tx: Tx, agencyId: string) {
  const [events, items, archives] = await Promise.all([
    tx.$queryRaw<EventRow[]>`SELECT * FROM app.agency_events_overview(${agencyId}::uuid)`,
    tx.$queryRaw<ItemRow[]>`SELECT * FROM app.agency_cost_items(${agencyId}::uuid)`,
    tx.eventArchive.findMany({ where: { agencyId, closedAt: { not: null } }, select: { eventId: true, summary: true } }),
  ]);
  const byId = new Map(events.map((e) => [e.event_id, e]));
  const summaries = new Map(archives.map((a) => [a.eventId, a.summary as ClosureSummary | null]));
  const rows: PriceRow[] = [];
  for (const i of items) {
    const e = byId.get(i.event_id);
    if (!e || e.archived) continue;
    const category = isCategory(i.category) ? i.category : null;
    rows.push({
      eventId: e.event_id, eventName: e.name, client: e.client_name, startsAt: e.starts_at, archived: false,
      code: itemCode(e.number, category, i.item_number),
      name: i.name, category, quantity: Number(i.quantity), unit: i.unit, supplier: i.supplier,
      estimated: lineSubtotal({ unitValue: n(i.unit_value), quantity: Number(i.quantity), frequency: n(i.frequency) }),
      quoted: n(i.lowest_quote) ?? n(i.quoted_value),
      contracted: n(i.contracted_value),
      actual: n(i.actual_value),
      optional: i.optional,
    });
  }
  for (const e of events) {
    if (!e.archived) continue;
    for (const i of summaries.get(e.event_id)?.items ?? []) {
      rows.push({
        eventId: e.event_id, eventName: e.name, client: e.client_name, startsAt: e.starts_at, archived: true,
        code: i.code, name: i.name, category: isCategory(i.category) ? i.category : null,
        quantity: i.quantity, unit: i.unit, supplier: i.supplier,
        estimated: i.estimated, quoted: i.quoted, contracted: i.contracted, actual: i.actual, optional: i.optional,
      });
    }
  }
  return { events, rows, summaries };
}

/** Os itens com preço de verdade: contratado ou realizado, fora os opcionais. */
const priced = (r: PriceRow) => !r.optional && itemCost(r) !== null;

const toPrice = (r: PriceRow) => {
  const cost = itemCost(r)!;
  return {
    eventId: r.eventId, eventName: r.eventName, client: r.client, startsAt: r.startsAt, archived: r.archived,
    code: r.code, name: r.name, category: r.category, quantity: r.quantity, unit: r.unit, supplier: r.supplier,
    contracted: r.contracted, actual: r.actual,
    /** O que foi pago (ou contratado, se ainda não pago). */
    cost,
    paid: r.actual !== null,
    perUnit: unitPrice(cost, r.quantity),
  };
};
export type PriceEntry = ReturnType<typeof toPrice>;

// ───────────────────────────── ranking de fornecedores ─────────────────────────────

export async function supplierRanking(actor: Actor, agencyId: string | null | undefined, filters: { category?: string } = {}) {
  const agency = resolveAgency(actor, agencyId);
  const category = isCategory(filters.category) ? filters.category : null;
  return actor.run(async (tx) => {
    const [suppliers, summaries] = await Promise.all([
      tx.supplier.findMany({
        where: { agencyId: agency.id, archivedAt: null },
        select: { id: true, companyName: true, tradeName: true, categories: true, city: true, state: true },
      }),
      ratingSummaries(tx, agency.id),
    ]);
    type Ranked = { id: string; name: string; categories: ItemCategory[]; place: string | null; rating: RatingSummary };
    const rated: Ranked[] = [];
    for (const s of suppliers) {
      const rating = summaries.get(s.id);
      if (!rating) continue;
      rated.push({
        id: s.id,
        name: s.tradeName || s.companyName,
        categories: (s.categories ?? []).filter(isCategory),
        place: [s.city, s.state].filter(Boolean).join(" · ") || null,
        rating,
      });
    }
    const order = (a: Ranked, b: Ranked) =>
      b.rating.overall - a.rating.overall || b.rating.ratings - a.rating.ratings || a.name.localeCompare(b.name, "pt-BR");
    rated.sort(order);
    const items = category ? rated.filter((s) => s.categories.includes(category)) : rated;
    // Os 3 melhores de cada categoria (para a visão geral).
    const byCategory = ITEM_CATEGORIES
      .map((c) => ({ category: c, top: rated.filter((s) => s.categories.includes(c)).slice(0, 3) }))
      .filter((g) => g.top.length > 0);
    return { agency, category, items, byCategory, unrated: suppliers.length - rated.length };
  });
}

// ───────────────────────────── banco de preços ─────────────────────────────

const PRICE_LIMIT = 200;

export async function priceBank(actor: Actor, agencyId: string | null | undefined, filters: { q?: string; category?: string } = {}) {
  const agency = resolveAgency(actor, agencyId);
  const q = (filters.q ?? "").trim().slice(0, 80);
  const category = isCategory(filters.category) ? filters.category : null;
  const { rows } = await actor.run((tx) => loadAgency(tx, agency.id));
  const found = rows
    .filter(priced)
    .filter((r) => (!category || r.category === category) && matchesQuery(q, r.name, r.supplier, r.code))
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime() || a.name.localeCompare(b.name, "pt-BR"))
    .map(toPrice);
  // Preço por unidade só compara itens da mesma unidade: a mais comum na busca.
  const units = new Map<string, number>();
  for (const r of found) if (r.perUnit !== null) units.set(r.unit ?? "", (units.get(r.unit ?? "") ?? 0) + 1);
  const unit = [...units.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const unitStats = q && unit !== undefined
    ? { unit: unit || null, ...spread(found.filter((r) => (r.unit ?? "") === unit && r.perUnit !== null).map((r) => r.perUnit!))! }
    : null;
  return {
    agency, q, category,
    items: found.slice(0, PRICE_LIMIT),
    total: found.length,
    events: new Set(found.map((r) => r.eventId)).size,
    unitStats,
  };
}

/**
 * Na cotação de um item: o que a agência pagou por itens parecidos em outros
 * eventos (mesma categoria, quando o item tem, e palavras do nome em comum).
 */
export async function similarPrices(actor: Actor, eventId: string, wanted: { name: string; category?: string | null }, limit = 5) {
  requireEventAccess(actor, eventId);
  if (!canReviewSla(actor, eventId)) throw new NotFoundError("Preços");
  const ws = words(wanted.name);
  const category = isCategory(wanted.category) ? wanted.category : null;
  if (!ws.length) return { items: [] as PriceEntry[], total: 0 };
  const { rows } = await actor.run(async (tx) => {
    const { agencyId } = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { agencyId: true } });
    return loadAgency(tx, agencyId);
  });
  const scored = rows
    .filter((r) => r.eventId !== eventId && priced(r) && (!category || !r.category || r.category === category))
    .map((r) => ({ r, score: matchScore(ws, r.name) }))
    // Na mesma categoria, uma palavra em comum basta; sem categoria, pelo menos duas (ou todas, em nome curto).
    .filter((x) => x.score >= (category ? 1 : Math.min(2, ws.length)))
    .sort((a, b) => b.score - a.score || b.r.startsAt.getTime() - a.r.startsAt.getTime());
  return { items: scored.slice(0, limit).map((x) => toPrice(x.r)), total: scored.length };
}

// ───────────────────────────── comparativo entre eventos ─────────────────────────────

export const COMPARE_MAX = 6;

export async function eventComparison(actor: Actor, agencyId: string | null | undefined, filters: { client?: string; events?: string[] } = {}) {
  const agency = resolveAgency(actor, agencyId);
  const { events, rows, summaries } = await actor.run((tx) => loadAgency(tx, agency.id));
  const clients = [...new Set(events.map((e) => e.client_name))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const client = filters.client && clients.includes(filters.client) ? filters.client : null;

  const list = events
    .filter((e) => !client || e.client_name === client)
    .map((e) => {
      const mine = rows.filter((r) => r.eventId === e.event_id);
      // Resumos antigos (antes de guardar os itens) só têm os totais.
      const old = e.archived && !mine.length ? summaries.get(e.event_id)?.totals : undefined;
      const totals: BudgetTotals = old
        ? { ...old, withQuoted: 0, withContracted: 0, withActual: 0 }
        : budgetTotals(mine);
      const counted = mine.filter((r) => !r.optional);
      const cost = old ? (old.actual || old.contracted) : Math.round(counted.reduce((s, r) => s + (itemCost(r) ?? 0), 0) * 100) / 100;
      const byCategory = new Map<ItemCategory | null, number>();
      for (const r of counted) {
        const c = itemCost(r);
        if (c !== null) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + c);
      }
      return {
        id: e.event_id, name: e.name, client: e.client_name, startsAt: e.starts_at, endsAt: e.ends_at, timezone: e.timezone,
        status: e.status, archived: e.archived, audience: e.audience,
        totals, cost, perPerson: perPerson(cost, e.audience), byCategory,
      };
    })
    .filter((e) => e.totals.items > 0 || e.cost > 0)
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());

  const valid = new Set(list.map((e) => e.id));
  const picked = (filters.events ?? []).filter((id) => uuid.safeParse(id).success && valid.has(id)).slice(0, COMPARE_MAX);
  const selected = picked.length ? picked : list.filter((e) => e.cost > 0).slice(0, 4).map((e) => e.id);
  const compared = selected.map((id) => list.find((e) => e.id === id)!);

  // Quanto cada categoria costuma custar (em todos os eventos da lista).
  const categories = [...ITEM_CATEGORIES, null].map((c) => {
    const withCat = list.filter((e) => (e.byCategory.get(c) ?? 0) > 0);
    return {
      category: c,
      cost: spread(withCat.map((e) => e.byCategory.get(c)!)),
      perPerson: spread(withCat.map((e) => perPerson(e.byCategory.get(c)!, e.audience)).filter((v): v is number => v !== null)),
      share: spread(withCat.filter((e) => e.cost > 0).map((e) => Math.round((e.byCategory.get(c)! / e.cost) * 1000) / 10)),
    };
  }).filter((c) => c.cost);

  return {
    agency, clients, client,
    events: list.map((e) => ({
      id: e.id, name: e.name, client: e.client, startsAt: e.startsAt, status: e.status, archived: e.archived,
      audience: e.audience, totals: e.totals, cost: e.cost, perPerson: e.perPerson, selected: selected.includes(e.id),
    })),
    compared: compared.map((e) => ({
      id: e.id, name: e.name, startsAt: e.startsAt, cost: e.cost, audience: e.audience, perPerson: e.perPerson,
      byCategory: Object.fromEntries([...e.byCategory.entries()].map(([k, v]) => [k ?? "", Math.round(v * 100) / 100])) as Record<string, number>,
    })),
    categories,
    perPersonAll: spread(list.map((e) => e.perPerson).filter((v): v is number => v !== null)),
  };
}
