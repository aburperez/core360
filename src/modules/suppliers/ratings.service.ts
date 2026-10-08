import { z } from "zod";
import type { Actor } from "../../server/authz/actor";
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
 * diretor dá de 0 a 10 em 6 critérios para cada fornecedor com contrato
 * assinado no evento. A média de todos os eventos da agência aparece no
 * cadastro e na cotação; as notas de cada evento e o comentário, só para o
 * diretor. A migration *_avaliacao_fornecedores repete as regras.
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

/** Os fornecedores com contrato assinado no evento, com a nota deste evento e a média geral. */
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
        select: { supplierId: true, ...scoresSelect, comment: true, updatedAt: true, ratedBy: { select: { name: true } } },
      }),
      ratingSummaries(tx, event.agencyId),
    ]);
    const byId = new Map(ratings.map((r) => [r.supplierId, r]));
    const items = ids.map((id) => {
      const cs = contracts.filter((c) => c.supplier.id === id);
      const r = byId.get(id);
      return {
        supplierId: id,
        name: cs[0]!.supplier.tradeName || cs[0]!.supplier.companyName,
        contracts: cs.map((c) => c.number),
        total: cs.reduce((s, c) => s + c.items.reduce((t, i) => t + Number(i.value), 0), 0),
        rating: r ? { ...pick(r), average: average(pick(r)), comment: r.comment, updatedAt: r.updatedAt, ratedBy: r.ratedBy.name } : null,
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

const pick = (r: Record<RatingKey, number>) =>
  Object.fromEntries(RATING_CRITERIA.map((c) => [c.key, r[c.key]])) as Record<RatingKey, number>;

const score = z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number({ message: "Dê uma nota de 0 a 10" }).int("Use nota inteira, de 0 a 10").min(0, "A nota vai de 0 a 10").max(10, "A nota vai de 0 a 10"));
const ratingSchema = z.object({
  ...Object.fromEntries(RATING_CRITERIA.map((c) => [c.key, score])) as Record<RatingKey, typeof score>,
  comment: optionalText(1000),
});

/** Dar ou corrigir a nota de um fornecedor no evento (só o diretor). */
export async function rateSupplier(actor: Actor, eventId: string, supplierId: string, input: unknown) {
  requireDirector(actor, eventId);
  if (!uuid.safeParse(supplierId).success) throw new NotFoundError("Fornecedor");
  const data = parse(ratingSchema, input);
  return actor.run(async (tx) => {
    const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { status: true } });
    if (!(RATING_OPEN_STATUSES as readonly string[]).includes(event.status)) {
      throw new ValidationError("A avaliação abre quando o evento chega no Fechamento");
    }
    const signed = await tx.contract.findFirst({ where: { eventId, supplierId, status: "ASSINADO" }, select: { id: true } });
    if (!signed) throw new ValidationError("Só fornecedor com contrato assinado no evento é avaliado");
    const before = await tx.supplierRating.findUnique({ where: { eventId_supplierId: { eventId, supplierId } }, select: { id: true, ...scoresSelect, comment: true } });
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
