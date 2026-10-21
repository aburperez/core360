import type { Prisma } from "../../generated/prisma/client";
import type { Actor } from "../../server/authz/actor";
import { canReviewSla, canUseSection, isExecutive } from "../../server/authz/policy";
import { ForbiddenError, NotFoundError } from "../../server/errors";
import type { Tx } from "../../server/db/with-user";
import { uuid } from "../../lib/validation";
import { requireEventAccess } from "../events/events.service";
import { normName } from "../areas/areas.service";
import { audit } from "../../server/audit/audit";
import {
  canSetItemStatus, effectiveCostCenter, ITEM_CATEGORIES, ITEM_STATUSES, itemCode, STRUCTURE_CATEGORIES, STRUCTURE_CENTERS,
  type CostCenter, type ItemCategory, type ItemStatus,
} from "./item-meta";

/**
 * Item do evento (fase 2 do roadmap): a linha da planilha de custos com
 * código, área, categoria, responsável, prazo, local, fornecedor e status.
 * O Mapa de itens mostra tudo isso SEM valores. Só a Pré-produção entra; a
 * RLS de cost_items aplica o mesmo perímetro e o gatilho cost_items_guard
 * repete quem muda o centro de custo e cada status. A edição usa
 * updateCostItem (PATCH /api/cost-items/:id), a mesma da planilha.
 */

function requirePre(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canUseSection(actor, eventId, "ITENS", "ORCAMENTO", "COTACOES")) throw new NotFoundError("Pré-produção");
}

const itemSelect = {
  id: true, eventId: true, number: true, name: true, description: true, quantity: true, unit: true,
  category: true, costCenter: true, status: true, neededOn: true, location: true, notes: true,
  areaId: true, responsibleId: true, dependsOnId: true, updatedAt: true,
  section: { select: { name: true } },
  area: { select: { name: true } },
  responsible: { select: { name: true } },
} satisfies Prisma.CostItemSelect;

type Row = Prisma.CostItemGetPayload<{ select: typeof itemSelect }>;

/** Fornecedor de cada item: o do orçamento escolhido na cotação fechada mais recente. */
async function suppliers(tx: Tx, eventId: string, itemIds?: string[]) {
  const closed = await tx.quoteRequest.findMany({
    where: { eventId, status: "FECHADA", chosenQuoteId: { not: null }, costItemId: itemIds ? { in: itemIds } : { not: null } },
    orderBy: { closedAt: "asc" },
    select: { id: true, costItemId: true, chosen: { select: { companyName: true } } },
  });
  // Em ordem: a mais recente fica por último e vale.
  return new Map(closed.map((q) => [q.costItemId!, { name: q.chosen?.companyName ?? null, quoteId: q.id }]));
}

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

function toItem(r: Row, eventNumber: number, supplier: { name: string | null; quoteId: string } | undefined) {
  return {
    id: r.id,
    code: itemCode(eventNumber, r.category as ItemCategory | null, r.number),
    number: r.number,
    name: r.name,
    description: r.description,
    sectionName: r.section.name,
    quantity: Number(r.quantity),
    unit: r.unit,
    category: r.category as ItemCategory | null,
    costCenter: effectiveCostCenter(r.category as ItemCategory | null, r.costCenter as CostCenter | null),
    costCenterChosen: r.costCenter as CostCenter | null,
    status: r.status as ItemStatus,
    neededOn: day(r.neededOn),
    location: r.location,
    notes: r.notes,
    areaId: r.areaId,
    areaName: r.area?.name ?? null,
    responsibleId: r.responsibleId,
    responsibleName: r.responsible?.name ?? null,
    dependsOnId: r.dependsOnId,
    supplier: supplier?.name ?? null,
    supplierQuoteId: supplier?.quoteId ?? null,
  };
}

export type MapItem = ReturnType<typeof toItem>;

/** Áreas do evento e quem pode ser responsável (pessoas ativas do evento). */
async function options(tx: Tx, eventId: string) {
  const areas = await tx.area.findMany({ where: { eventId, deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const people = await tx.participant.findMany({
    where: { eventId, active: true, deletedAt: null, role: { not: "CLIENTE" } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  });
  return { areas, people };
}

export interface ItemFilters {
  area?: string | null;
  status?: string | null;
  responsible?: string | null;
  category?: string | null;
}

/** Filtros que vieram da URL: só valores válidos (o resto é ignorado). */
function cleanFilters(f: ItemFilters) {
  const id = (v?: string | null) => (v === "none" ? "none" : v && uuid.safeParse(v).success ? v : null);
  return {
    area: id(f.area),
    responsible: id(f.responsible),
    status: f.status && (ITEM_STATUSES as readonly string[]).includes(f.status) ? (f.status as ItemStatus) : null,
    category: (f.category === "none" ? "none" : f.category && (ITEM_CATEGORIES as readonly string[]).includes(f.category) ? f.category : null) as ItemCategory | "none" | null,
  };
}

/**
 * Estrutura e cenografia (a área do Produtor executivo): centros 01 INFRA e
 * 02 CENO, pelo centro escolhido ou, sem ele, pela categoria.
 */
export const structureItemWhere = {
  OR: [
    { costCenter: { in: [...STRUCTURE_CENTERS] } },
    { costCenter: null, category: { in: [...STRUCTURE_CATEGORIES] } },
  ],
} satisfies Prisma.CostItemWhereInput;

/** Mapa de itens: todos os itens do evento, sem valores, com filtros. O Produtor executivo vê os de estrutura e cenografia. */
export async function listItemMap(actor: Actor, eventId: string, filters: ItemFilters = {}) {
  requirePre(actor, eventId);
  const f = cleanFilters(filters);
  const scope: Prisma.CostItemWhereInput = isExecutive(actor, eventId) ? { eventId, ...structureItemWhere } : { eventId };
  const where: Prisma.CostItemWhereInput = {
    ...scope,
    ...(f.area && { areaId: f.area === "none" ? null : f.area }),
    ...(f.responsible && { responsibleId: f.responsible === "none" ? null : f.responsible }),
    ...(f.status && { status: f.status }),
    ...(f.category && { category: f.category === "none" ? null : f.category }),
  };
  return actor.run(async (tx) => {
    const { number } = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { number: true } });
    const rows = await tx.costItem.findMany({ where, orderBy: { number: "asc" }, select: itemSelect });
    const supplierOf = await suppliers(tx, eventId);
    const counts = await tx.costItem.groupBy({ by: ["status"], where: scope, _count: { _all: true } });
    const total = counts.reduce((a, c) => a + c._count._all, 0);
    const withoutArea = await tx.costItem.count({ where: { ...scope, areaId: null } });
    return {
      items: rows.map((r) => toItem(r, number, supplierOf.get(r.id))),
      total,
      byStatus: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Partial<Record<ItemStatus, number>>,
      filters: f,
      /** Só estrutura e cenografia (Produtor executivo). */
      structureOnly: isExecutive(actor, eventId),
      /** Itens ainda sem área (do evento todo). */
      withoutArea,
      ...(await options(tx, eventId)),
    };
  });
}

/** Um item, com o que a tela de edição precisa e o que a pessoa pode mudar. */
export async function getItem(actor: Actor, itemId: string) {
  return actor.run(async (tx) => {
    const r = uuid.safeParse(itemId).success ? await tx.costItem.findUnique({ where: { id: itemId }, select: itemSelect }) : null;
    if (!r || !canUseSection(actor, r.eventId, "ITENS", "ORCAMENTO", "COTACOES")) throw new NotFoundError("Item");
    const { number } = await tx.event.findUniqueOrThrow({ where: { id: r.eventId }, select: { number: true } });
    const supplier = (await suppliers(tx, r.eventId, [r.id])).get(r.id);
    const director = canReviewSla(actor, r.eventId);
    const item = toItem(r, number, supplier);
    // Para o "Depende de": os outros itens do evento.
    const others = await tx.costItem.findMany({
      where: { eventId: r.eventId, id: { not: r.id } },
      orderBy: { number: "asc" },
      select: { id: true, name: true, number: true, category: true },
    });
    const quotes = await tx.quoteRequest.findMany({
      where: { costItemId: r.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, status: true },
    });
    return {
      eventId: r.eventId,
      item,
      quotes,
      others: others.map((o) => ({ id: o.id, name: `${itemCode(number, o.category as ItemCategory | null, o.number)} ${o.name}` })),
      ...(await options(tx, r.eventId)),
      can: {
        director,
        costCenter: director,
        statuses: ITEM_STATUSES.filter((s) => canSetItemStatus(item.status, s, director)),
      },
    };
  });
}

/** Palavras do nome da área que recebe cada categoria, em ordem de preferência. */
const AREA_KEYS: Partial<Record<ItemCategory, string[]>> = {
  INFRAESTRUTURA: ["infra"],
  LOCACAO: ["infra"],
  CENOGRAFIA: ["ceno"],
  MOBILIARIO: ["ceno"],
  COMUNICACAO_VISUAL: ["comunicacao visual", "ceno"],
  TECNICA: ["tecnica"],
  AUDIOVISUAL: ["audiovisual", "tecnica"],
  ILUMINACAO: ["iluminacao", "tecnica"],
  SEGURANCA: ["seguranca", "operac"],
  LIMPEZA: ["limpeza", "operac"],
  ALIMENTACAO: ["a&b", "alimentacao"],
  TRANSPORTE: ["logistica"],
  HOSPEDAGEM: ["logistica"],
  LOGISTICA: ["logistica"],
  RECURSOS_HUMANOS: ["staff", "apoio"],
};

/** A área sugerida para um item, pela categoria dele (ex.: Cenografia vai para a área Cenografia). */
export function suggestArea(category: ItemCategory | null, areas: { id: string; name: string }[]): string | null {
  for (const key of (category && AREA_KEYS[category]) || []) {
    const hit = areas.find((a) => normName(a.name).startsWith(key)) ?? areas.find((a) => normName(a.name).includes(key));
    if (hit) return hit.id;
  }
  return null;
}

/**
 * Pré-produção por área (2026-10-21): o gestor põe cada item sem área na área
 * da categoria dele, de uma vez. Os que não têm área parecida ficam do evento
 * todo (só o gestor e quem não tem área veem).
 */
export async function distributeItemsByArea(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canReviewSla(actor, eventId)) throw new ForbiddenError("Só o Gerente de produção e o diretor distribuem os itens pelas áreas");
  return actor.run(async (tx) => {
    const areas = await tx.area.findMany({ where: { eventId, deletedAt: null }, select: { id: true, name: true } });
    const items = await tx.costItem.findMany({ where: { eventId, areaId: null }, select: { id: true, category: true } });
    let assigned = 0;
    for (const it of items) {
      const areaId = suggestArea(it.category as ItemCategory | null, areas);
      if (!areaId) continue;
      await tx.costItem.update({ where: { id: it.id }, data: { areaId } });
      assigned++;
    }
    if (assigned) await audit(tx, actor, { eventId, entity: "cost_item", action: "UPDATE", after: { distributedByArea: assigned } });
    return { assigned, left: items.length - assigned };
  });
}
