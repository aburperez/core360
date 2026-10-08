import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client";
import type { Actor } from "../../server/authz/actor";
import { canReviewSla, canUsePreProduction } from "../../server/authz/policy";
import { audit, diff } from "../../server/audit/audit";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../server/errors";
import { isUniqueViolation } from "../../server/db/errors";
import type { Tx } from "../../server/db/with-user";
import { normalizeCnpj } from "../../lib/cnpj";
import { parseDecimal } from "../../lib/money";
import { normalizePhone } from "../../lib/phone";
import { optionalText, parse, text, uuid } from "../../lib/validation";
import { requireEventAccess } from "../events/events.service";
import { ITEM_CATEGORIES, itemCode, type ItemCategory } from "../items/item-meta";
import { canSeeContractedSuppliers, isSupplierDirector } from "./supplier-meta";

/**
 * Cadastro de fornecedores da agência (fase 3A). Um fornecedor por CNPJ em cada
 * agência, usado em todos os eventos dela; as telas entram pelo evento e
 * mostram o cadastro da agência dona dele. A Pré-produção cadastra e edita; só o
 * diretor (Gerente ou Admin) arquiva e mexe na bonificação, que o Pré-produtor
 * nem vê. O Head vê, no campo, os fornecedores contratados para a área dele,
 * com a bonificação e sem valores. A RLS e os gatilhos da migration
 * *_fornecedores repetem as regras.
 */

function requirePre(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canUsePreProduction(actor, eventId)) throw new NotFoundError("Pré-produção");
}

async function agencyOf(tx: Tx, eventId: string) {
  const e = await tx.event.findUnique({ where: { id: eventId }, select: { agencyId: true, number: true } });
  if (!e) throw new NotFoundError("Evento");
  return e;
}

async function loadSupplier(tx: Tx, agencyId: string, supplierId: string) {
  const s = uuid.safeParse(supplierId).success ? await tx.supplier.findUnique({ where: { id: supplierId } }) : null;
  if (!s || s.agencyId !== agencyId) throw new NotFoundError("Fornecedor");
  return s;
}

const phone = (label: string) =>
  z.string().trim().max(30).optional().nullable().transform((v, ctx) => {
    if (!v) return null;
    const n = normalizePhone(v);
    if (!n) ctx.addIssue({ code: "custom", message: `${label} inválido. Use DDD + número` });
    return n ?? null;
  });

export const cnpjField = z.string().trim().transform((v, ctx) => {
  const n = normalizeCnpj(v);
  if (!n) ctx.addIssue({ code: "custom", message: "CNPJ inválido" });
  return n ?? "";
});

const supplierSchema = z.object({
  cnpj: cnpjField,
  companyName: text(160),
  tradeName: optionalText(160),
  contactName: optionalText(120),
  phone: phone("Telefone"),
  whatsapp: phone("WhatsApp"),
  email: z.string().trim().max(160).optional().nullable()
    .transform((v) => v || null)
    .pipe(z.email({ message: "E-mail inválido" }).nullable()),
  city: optionalText(120),
  state: z.string().trim().toUpperCase().optional().nullable().transform((v) => v || null)
    .pipe(z.string().regex(/^[A-Z]{2}$/, "Use a sigla do estado, ex.: SP").nullable()),
  region: optionalText(300),
  categories: z.array(z.enum(ITEM_CATEGORIES)).max(ITEM_CATEGORIES.length).optional()
    .transform((v) => (v ? [...new Set(v)] : [])),
  specialty: optionalText(300),
  team: optionalText(1000),
  equipment: optionalText(1000),
  capacity: optionalText(1000),
  notes: optionalText(2000),
});
type SupplierInput = z.output<typeof supplierSchema>;

const listSelect = {
  id: true, cnpj: true, companyName: true, tradeName: true, contactName: true, phone: true, whatsapp: true, email: true,
  city: true, state: true, categories: true, archivedAt: true,
} satisfies Prisma.SupplierSelect;

const fullSelect = {
  ...listSelect, region: true, specialty: true, team: true, equipment: true, capacity: true, notes: true,
  createdAt: true, updatedAt: true, createdBy: { select: { name: true } },
} satisfies Prisma.SupplierSelect;

type BonusRow = { kind: "PERCENTUAL" | "VALOR"; value: Prisma.Decimal; notes: string | null; updatedAt: Date; updatedBy: { name: string } };
const bonusSelect = { kind: true, value: true, notes: true, updatedAt: true, updatedBy: { select: { name: true } } } as const;
const toBonus = (b: BonusRow | null) =>
  b && { kind: b.kind, value: Number(b.value), notes: b.notes, updatedAt: b.updatedAt, updatedBy: b.updatedBy.name };

/** O que a pessoa pode fazer no cadastro, pelo evento por onde entrou. */
function abilities(actor: Actor, eventId: string) {
  const director = isSupplierDirector(actor, eventId);
  return { edit: !actor.supportEventIds.has(eventId), director, archive: director };
}

/** Cadastro da agência dona do evento, com busca e filtro por categoria. */
export async function listSuppliers(actor: Actor, eventId: string, filters: { q?: string; category?: string; archived?: boolean } = {}) {
  requirePre(actor, eventId);
  const can = abilities(actor, eventId);
  return actor.run(async (tx) => {
    const { agencyId } = await agencyOf(tx, eventId);
    const q = filters.q?.trim().slice(0, 80) ?? "";
    const digits = q.replace(/\D/g, "");
    const category = (ITEM_CATEGORIES as readonly string[]).includes(filters.category ?? "") ? (filters.category as ItemCategory) : null;
    const where: Prisma.SupplierWhereInput = {
      agencyId,
      archivedAt: filters.archived ? { not: null } : null,
      ...(category && { categories: { has: category } }),
      ...(q && {
        OR: [
          { companyName: { contains: q, mode: "insensitive" } },
          { tradeName: { contains: q, mode: "insensitive" } },
          { specialty: { contains: q, mode: "insensitive" } },
          { city: { contains: q, mode: "insensitive" } },
          ...(digits.length >= 3 ? [{ cnpj: { contains: digits } }] : []),
        ],
      }),
    };
    const [rows, archived] = await Promise.all([
      tx.supplier.findMany({
        where, orderBy: { companyName: "asc" }, take: 500,
        select: { ...listSelect, _count: { select: { quotes: true } }, ...(can.director && { bonus: { select: bonusSelect } }) },
      }),
      tx.supplier.count({ where: { agencyId, archivedAt: { not: null } } }),
    ]);
    const chosen = await chosenCounts(tx, rows.map((r) => r.id));
    return {
      items: rows.map(({ _count, ...r }) => ({
        ...r,
        categories: r.categories ?? [],
        bonus: "bonus" in r ? toBonus((r.bonus as BonusRow | null) ?? null) : null,
        quotes: _count.quotes,
        won: chosen.get(r.id) ?? 0,
      })),
      archivedCount: archived,
      filters: { q, category, archived: !!filters.archived },
      can,
    };
  });
}

/** Quantas vezes cada fornecedor foi o escolhido numa cotação. */
async function chosenCounts(tx: Tx, ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const rows = await tx.supplierQuote.groupBy({
    by: ["supplierId"],
    where: { supplierId: { in: ids }, chosenBy: { some: { status: "FECHADA" } } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.supplierId, r._count._all]));
}

/** Ficha do fornecedor: dados, bonificação (diretor) e o histórico de orçamentos na agência. */
export async function getSupplier(actor: Actor, eventId: string, supplierId: string) {
  requirePre(actor, eventId);
  const can = abilities(actor, eventId);
  return actor.run(async (tx) => {
    const { agencyId } = await agencyOf(tx, eventId);
    await loadSupplier(tx, agencyId, supplierId);
    const [s, bonus, quotes] = await Promise.all([
      tx.supplier.findUniqueOrThrow({ where: { id: supplierId }, select: fullSelect }),
      can.director ? tx.supplierBonus.findUnique({ where: { supplierId }, select: bonusSelect }) : null,
      // Só os orçamentos de eventos em que a pessoa entra na Pré-produção (a RLS filtra).
      tx.supplierQuote.findMany({
        where: { supplierId },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true, totalValue: true, negotiatedValue: true, status: true, createdAt: true,
          event: { select: { id: true, name: true } },
          request: { select: { id: true, title: true, status: true, chosenQuoteId: true } },
        },
      }),
    ]);
    return {
      supplier: { ...s, categories: s.categories ?? [], createdBy: s.createdBy.name },
      bonus: toBonus(bonus),
      history: quotes.map((q) => ({
        id: q.id, eventId: q.event.id, eventName: q.event.name, requestId: q.request.id, title: q.request.title,
        value: q.negotiatedValue !== null ? Number(q.negotiatedValue) : q.totalValue !== null ? Number(q.totalValue) : null, date: q.createdAt,
        result: q.request.chosenQuoteId === q.id ? ("ESCOLHIDO" as const)
          : q.request.status === "FECHADA" ? ("NAO_ESCOLHIDO" as const)
          : q.request.status === "CANCELADA" ? ("CANCELADA" as const) : ("EM_ANDAMENTO" as const),
      })),
      can,
    };
  });
}

function requireEdit(actor: Actor, eventId: string) {
  if (actor.supportEventIds.has(eventId)) throw new ForbiddenError("O Suporte só consulta o cadastro");
}

const duplicate = async (tx: Tx, agencyId: string, cnpj: string) =>
  tx.supplier.findUnique({ where: { agencyId_cnpj: { agencyId, cnpj } }, select: { id: true, companyName: true, archivedAt: true } });

export async function createSupplier(actor: Actor, eventId: string, input: unknown) {
  requirePre(actor, eventId);
  requireEdit(actor, eventId);
  const data = parse(supplierSchema, input);
  try {
    return await actor.run(async (tx) => {
      const { agencyId } = await agencyOf(tx, eventId);
      const dup = await duplicate(tx, agencyId, data.cnpj);
      if (dup) throw new ConflictError(`Esse CNPJ já está no cadastro: ${dup.companyName}${dup.archivedAt ? " (arquivado)" : ""}`);
      const s = await tx.supplier.create({ data: { ...data, agencyId, createdById: actor.userId }, select: { id: true } });
      await audit(tx, actor, { eventId, entity: "supplier", entityId: s.id, action: "CREATE", after: data });
      return s;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError("Esse CNPJ acabou de ser cadastrado por outra pessoa. Atualize a tela.");
    throw e;
  }
}

/** Corrige os dados. O CNPJ não muda: um CNPJ diferente é outro fornecedor. */
export async function updateSupplier(actor: Actor, eventId: string, supplierId: string, input: unknown) {
  requirePre(actor, eventId);
  requireEdit(actor, eventId);
  const sent = (input ?? {}) as Record<string, unknown>;
  if ("cnpj" in sent) throw new ValidationError("O CNPJ não muda. Um CNPJ diferente é outro fornecedor.");
  const data = parse(supplierSchema.omit({ cnpj: true }).partial(), input);
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => k in sent)) as Partial<SupplierInput>;
  return actor.run(async (tx) => {
    const { agencyId } = await agencyOf(tx, eventId);
    const before = await loadSupplier(tx, agencyId, supplierId);
    if (!Object.keys(patch).length) return { id: before.id };
    await tx.supplier.update({ where: { id: before.id }, data: patch });
    await audit(tx, actor, { eventId, entity: "supplier", entityId: before.id, action: "UPDATE", ...diff(before, patch) });
    return { id: before.id };
  });
}

/** Arquivar (sai das listas e das cotações novas) ou reativar: só o diretor. */
export async function setSupplierArchived(actor: Actor, eventId: string, supplierId: string, input: unknown) {
  requirePre(actor, eventId);
  if (!abilities(actor, eventId).archive) throw new ForbiddenError("Só o diretor arquiva ou reativa um fornecedor");
  const { archived } = parse(z.object({ archived: z.boolean() }), input);
  return actor.run(async (tx) => {
    const { agencyId } = await agencyOf(tx, eventId);
    const s = await loadSupplier(tx, agencyId, supplierId);
    if (!!s.archivedAt === archived) return { id: s.id, archived };
    await tx.supplier.update({ where: { id: s.id }, data: { archivedAt: archived ? new Date() : null } });
    await audit(tx, actor, { eventId, entity: "supplier", entityId: s.id, action: archived ? "DEACTIVATE" : "ACTIVATE" });
    return { id: s.id, archived };
  });
}

const bonusSchema = z.object({
  kind: z.enum(["PERCENTUAL", "VALOR"]),
  value: z.union([z.number(), z.string()]).transform((v, ctx) => {
    const n = typeof v === "number" ? v : parseDecimal(v);
    if (n === null || n < 0) ctx.addIssue({ code: "custom", message: "Valor inválido" });
    return n ?? 0;
  }),
  notes: optionalText(500),
}).refine((b) => b.kind !== "PERCENTUAL" || b.value <= 100, { message: "O percentual vai de 0 a 100", path: ["value"] });

/** Bonificação do fornecedor: só o diretor preenche ou tira (null). */
export async function setSupplierBonus(actor: Actor, eventId: string, supplierId: string, input: unknown) {
  requirePre(actor, eventId);
  if (!abilities(actor, eventId).director) throw new ForbiddenError("Só o diretor de produção preenche a bonificação");
  const data = input === null ? null : parse(bonusSchema, input);
  return actor.run(async (tx) => {
    const { agencyId } = await agencyOf(tx, eventId);
    const s = await loadSupplier(tx, agencyId, supplierId);
    const before = await tx.supplierBonus.findUnique({ where: { supplierId: s.id } });
    const plain = (b: { kind: string; value: unknown; notes: string | null } | null) => b && { kind: b.kind, value: Number(b.value), notes: b.notes };
    if (!data) {
      if (before) await tx.supplierBonus.delete({ where: { supplierId: s.id } });
      await audit(tx, actor, { eventId, entity: "supplier_bonus", entityId: s.id, action: "DELETE", before: plain(before) });
      return { bonus: null };
    }
    const b = await tx.supplierBonus.upsert({
      where: { supplierId: s.id },
      create: { supplierId: s.id, ...data, updatedById: actor.userId },
      update: { ...data, updatedById: actor.userId },
      select: bonusSelect,
    });
    await audit(tx, actor, { eventId, entity: "supplier_bonus", entityId: s.id, action: before ? "UPDATE" : "CREATE", before: plain(before), after: plain(b) });
    return { bonus: toBonus(b) };
  });
}

/**
 * Fornecedores para o orçamento da cotação: os ativos da agência, com os da
 * categoria do item primeiro (marcados como sugeridos).
 */
export async function supplierOptions(tx: Tx, eventId: string, category: ItemCategory | null) {
  const { agencyId } = await agencyOf(tx, eventId);
  const rows = await tx.supplier.findMany({
    where: { agencyId, archivedAt: null },
    orderBy: { companyName: "asc" },
    take: 1000,
    select: { id: true, cnpj: true, companyName: true, tradeName: true, contactName: true, phone: true, email: true, categories: true },
  });
  const list = rows.map((r) => ({ ...r, categories: r.categories ?? [], suggested: !!category && (r.categories ?? []).includes(category) }));
  return [...list.filter((r) => r.suggested), ...list.filter((r) => !r.suggested)];
}

/**
 * O fornecedor do orçamento: o do cadastro com esse CNPJ, ou um novo (o "Novo
 * fornecedor" do formulário), criado com os dados do orçamento. Um do cadastro
 * sem contato ganha o do orçamento.
 */
export async function resolveSupplier(
  tx: Tx, actor: Actor, eventId: string,
  q: { cnpj: string; companyName: string; contactName: string; phone: string; email: string },
) {
  const { agencyId } = await agencyOf(tx, eventId);
  const found = await tx.supplier.findUnique({ where: { agencyId_cnpj: { agencyId, cnpj: q.cnpj } } });
  if (found) {
    if (found.archivedAt) throw new ValidationError(`${found.companyName} está arquivado. Peça ao diretor para reativar.`);
    const fill = {
      ...(!found.contactName && { contactName: q.contactName }),
      ...(!found.phone && { phone: q.phone }),
      ...(!found.email && { email: q.email }),
    };
    if (Object.keys(fill).length) await tx.supplier.update({ where: { id: found.id }, data: fill });
    return { id: found.id, created: false };
  }
  const s = await tx.supplier.create({
    data: {
      agencyId, cnpj: q.cnpj, companyName: q.companyName, contactName: q.contactName, phone: q.phone, email: q.email,
      createdById: actor.userId,
    },
    select: { id: true },
  });
  await audit(tx, actor, { eventId, entity: "supplier", entityId: s.id, action: "CREATE", after: { ...q, from: "orcamento" } });
  return { id: s.id, created: true };
}

/**
 * Campo: os fornecedores contratados no evento (escolhidos numa cotação), sem
 * valores. O gestor vê todos; o Head, os dos itens da área dele, com a
 * bonificação. O resto não entra.
 */
export async function listContractedSuppliers(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canSeeContractedSuppliers(actor, eventId)) throw new NotFoundError("Fornecedores");
  return actor.run(async (tx) => {
    const { number } = await agencyOf(tx, eventId);
    const links = await tx.$queryRaw<{ supplier_id: string; item_id: string; item_name: string; item_number: number; item_category: ItemCategory | null; area_id: string | null }[]>`
      SELECT * FROM app.event_contracted_suppliers(${eventId}::uuid)`;
    const ids = [...new Set(links.map((l) => l.supplier_id))];
    const areaIds = [...new Set(links.map((l) => l.area_id).filter((a): a is string => !!a))];
    const [suppliers, bonuses, areas] = await Promise.all([
      tx.supplier.findMany({
        where: { id: { in: ids } }, orderBy: { companyName: "asc" },
        select: { id: true, companyName: true, tradeName: true, contactName: true, phone: true, whatsapp: true, email: true },
      }),
      tx.supplierBonus.findMany({ where: { supplierId: { in: ids } }, select: { supplierId: true, ...bonusSelect } }),
      tx.area.findMany({ where: { id: { in: areaIds } }, select: { id: true, name: true } }),
    ]);
    const bonusBy = new Map(bonuses.map(({ supplierId, ...b }) => [supplierId, toBonus(b)]));
    const areaName = new Map(areas.map((a) => [a.id, a.name]));
    return {
      items: suppliers.map((s) => ({
        ...s,
        bonus: bonusBy.get(s.id) ?? null,
        // Um item fechado mais de uma vez (cotação reaberta e fechada de novo) aparece uma vez só.
        items: links.filter((l, i) => l.supplier_id === s.id && links.findIndex((x) => x.supplier_id === s.id && x.item_id === l.item_id) === i).map((l) => ({
          id: l.item_id, name: l.item_name, code: itemCode(number, l.item_category, l.item_number),
          area: l.area_id ? (areaName.get(l.area_id) ?? null) : null,
        })),
      })),
      director: canReviewSla(actor, eventId),
    };
  });
}
