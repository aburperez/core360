import { z } from "zod";
import { membershipFor, type Actor } from "../../server/authz/actor";
import { canUsePreProduction } from "../../server/authz/policy";
import { audit, diff } from "../../server/audit/audit";
import { ForbiddenError, NotFoundError, ValidationError } from "../../server/errors";
import type { Tx } from "../../server/db/with-user";
import { optionalText, parse, uuid } from "../../lib/validation";
import { requireEventAccess } from "../events/events.service";
import { isSupplierDirector } from "./supplier-meta";
import { RATING_CRITERIA, RATING_OPEN_STATUSES, type RatingKey } from "./rating-meta";

/**
 * Avaliação dos fornecedores (fase 3D). Quando o evento chega no Fechamento, o
 * diretor e o Head da área dão de 0 a 10 em 6 critérios para cada fornecedor
 * com contrato assinado no evento (o Head, os que têm item da área dele). Cada
 * pessoa dá a sua nota; a do evento é a média de todas. A média de todos os
 * eventos da agência aparece no cadastro e na cotação; as notas de cada um e o
 * comentário, só para o diretor (o Head vê a sua). As migrations
 * *_avaliacao_fornecedores e *_avaliacao_head repetem as regras.
 */

export type RatingSummary = { ratings: number; overall: number } & Record<RatingKey, number>;

/** Médias por fornecedor na agência (vazio para quem não vê o cadastro). */
export async function ratingSummaries(tx: Tx, agencyId: string): Promise<Map<string, RatingSummary>> {
  const rows = await tx.$queryRaw<{
    supplier_id: string; ratings: number; overall: string; quality: string; deadline: string; service: string;
    cost: string; flexibility: string; problem_solving: string;
  }[]>`SELECT * FROM app.supplier_rating_summary(${agencyId}::uuid)`;
  return new Map(rows.map((r) => [r.supplier_id, {
    ratings: r.ratings, overall: Number(r.overall), quality: Number(r.quality), deadline: Number(r.deadline),
    service: Number(r.service), cost: Number(r.cost), flexibility: Number(r.flexibility), problemSolving: Number(r.problem_solving),
  }]));
}

const scoresSelect = { quality: true, deadline: true, service: true, cost: true, flexibility: true, problemSolving: true } as const;
const average = (r: Record<RatingKey, number>) => Math.round((RATING_CRITERIA.reduce((s, c) => s + r[c.key], 0) / RATING_CRITERIA.length) * 10) / 10;

function requireDirector(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canUsePreProduction(actor, eventId)) throw new NotFoundError("Pré-produção");
  if (!isSupplierDirector(actor, eventId)) throw new ForbiddenError("Só o diretor avalia os fornecedores");
}

type Scored = Record<RatingKey, number> & { comment: string | null; updatedAt: Date; ratedById: string; ratedBy: { name: string } };
const toRating = (r: Scored) => ({ ...pick(r), average: average(pick(r)), comment: r.comment, updatedAt: r.updatedAt, ratedBy: r.ratedBy.name });
const avgOf = (ns: number[]) => (ns.length ? Math.round((ns.reduce((a, b) => a + b, 0) / ns.length) * 10) / 10 : null);

/**
 * Os fornecedores com contrato assinado no evento (tela do diretor): a nota
 * dele, as dos Heads, a média do evento e a média geral.
 */
export async function listEventRatings(actor: Actor, eventId: string) {
  requireDirector(actor, eventId);
  return actor.run(async (tx) => {
    const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { name: true, status: true, agencyId: true } });
    const contracts = await tx.contract.findMany({
      where: { eventId, status: "ASSINADO" },
      orderBy: { number: "asc" },
      select: { number: true, supplier: { select: { id: true, companyName: true, tradeName: true } }, items: { select: { value: true } } },
    });
    const ids = [...new Set(contracts.map((c) => c.supplier.id))];
    const [ratings, summaries] = await Promise.all([
      tx.supplierRating.findMany({
        where: { eventId, supplierId: { in: ids } },
        orderBy: { createdAt: "asc" },
        select: { supplierId: true, ...scoresSelect, comment: true, updatedAt: true, ratedById: true, ratedBy: { select: { name: true } } },
      }),
      ratingSummaries(tx, event.agencyId),
    ]);
    const items = ids.map((id) => {
      const cs = contracts.filter((c) => c.supplier.id === id);
      const rs = ratings.filter((r) => r.supplierId === id);
      const mine = rs.find((r) => r.ratedById === actor.userId);
      return {
        supplierId: id,
        name: cs[0]!.supplier.tradeName || cs[0]!.supplier.companyName,
        contracts: cs.map((c) => c.number),
        total: cs.reduce((s, c) => s + c.items.reduce((t, i) => t + Number(i.value), 0), 0),
        /** A nota de quem está vendo. */
        rating: mine ? toRating(mine) : null,
        /** As notas dos outros (os Heads e outro diretor). */
        others: rs.filter((r) => r !== mine).map(toRating),
        /** Média do evento: todas as notas. */
        eventAverage: avgOf(rs.map((r) => average(pick(r)))),
        history: summaries.get(id) ?? null,
      };
    });
    return {
      eventName: event.name,
      status: event.status,
      open: (RATING_OPEN_STATUSES as readonly string[]).includes(event.status),
      items,
      done: items.filter((i) => i.rating).length,
    };
  });
}

/**
 * Tela Fornecedores do campo: quais o Head (ou o gestor) avalia aqui e a nota
 * que já deu. Sem valores.
 */
export async function myRatings(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  return actor.run(async (tx) => {
    const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { status: true } });
    const open = (RATING_OPEN_STATUSES as readonly string[]).includes(event.status);
    if (!open) return { open, canRate: new Set<string>(), mine: new Map<string, ReturnType<typeof toRating>>() };
    const rows = await tx.$queryRaw<{ supplier_id: string }[]>`
      SELECT DISTINCT supplier_id FROM app.event_contracted_suppliers(${eventId}::uuid)
       WHERE app.can_rate_supplier(${eventId}::uuid, supplier_id)`;
    const mine = await tx.supplierRating.findMany({
      where: { eventId, ratedById: actor.userId },
      select: { supplierId: true, ...scoresSelect, comment: true, updatedAt: true, ratedById: true, ratedBy: { select: { name: true } } },
    });
    return { open, canRate: new Set(rows.map((r) => r.supplier_id)), mine: new Map(mine.map((r) => [r.supplierId, toRating(r)])) };
  });
}

const pick = (r: Record<RatingKey, number>) =>
  Object.fromEntries(RATING_CRITERIA.map((c) => [c.key, r[c.key]])) as Record<RatingKey, number>;

const score = z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number({ message: "Dê uma nota de 0 a 10" }).int("Use nota inteira, de 0 a 10").min(0, "A nota vai de 0 a 10").max(10, "A nota vai de 0 a 10"));
const ratingSchema = z.object({
  ...Object.fromEntries(RATING_CRITERIA.map((c) => [c.key, score])) as Record<RatingKey, typeof score>,
  comment: optionalText(1000),
});

/** Dar ou corrigir a própria nota de um fornecedor no evento (o diretor ou o Head da área). */
export async function rateSupplier(actor: Actor, eventId: string, supplierId: string, input: unknown) {
  requireEventAccess(actor, eventId);
  if (!canUsePreProduction(actor, eventId) && membershipFor(actor, eventId)?.role !== "HEAD") throw new NotFoundError("Fornecedor");
  if (!uuid.safeParse(supplierId).success) throw new NotFoundError("Fornecedor");
  const data = parse(ratingSchema, input);
  return actor.run(async (tx) => {
    const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { status: true } });
    if (!(RATING_OPEN_STATUSES as readonly string[]).includes(event.status)) {
      throw new ValidationError("A avaliação abre quando o evento chega no Fechamento");
    }
    const [{ signed, allowed }] = await tx.$queryRaw<{ signed: boolean; allowed: boolean }[]>`
      SELECT app.supplier_signed_in_event(${eventId}::uuid, ${supplierId}::uuid) AS signed,
             app.can_rate_supplier(${eventId}::uuid, ${supplierId}::uuid) AS allowed`;
    if (!signed) throw new ValidationError("Só fornecedor com contrato assinado no evento é avaliado");
    if (!allowed) throw new ForbiddenError("Só o diretor e o Head da área avaliam este fornecedor");
    const before = await tx.supplierRating.findUnique({
      where: { eventId_supplierId_ratedById: { eventId, supplierId, ratedById: actor.userId } },
      select: { id: true, ...scoresSelect, comment: true },
    });
    const values = { ...pick(data), comment: data.comment ?? null, ratedById: actor.userId };
    const saved = before
      ? await tx.supplierRating.update({ where: { id: before.id }, data: values, select: { id: true, ...scoresSelect, comment: true } })
      : await tx.supplierRating.create({ data: { eventId, supplierId, ...values }, select: { id: true, ...scoresSelect, comment: true } });
    const { id, ...after } = saved;
    if (before) {
      await audit(tx, actor, { eventId, entity: "supplier_rating", entityId: id, action: "UPDATE", ...diff({ ...pick(before), comment: before.comment }, after) });
    } else {
      await audit(tx, actor, { eventId, entity: "supplier_rating", entityId: id, action: "CREATE", after: { supplierId, ...after } });
    }
    return { ...after, average: average(pick(after)) };
  });
}
