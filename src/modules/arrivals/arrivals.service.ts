import { z } from "zod";
import type { Actor } from "../../server/authz/actor";
import { isEventAdmin, membershipFor } from "../../server/authz/actor";
import { canUseField, canUsePreProduction } from "../../server/authz/policy";
import { audit, diff } from "../../server/audit/audit";
import { NotFoundError, ValidationError } from "../../server/errors";
import type { Tx } from "../../server/db/with-user";
import { optionalText, parse, text, uuid } from "../../lib/validation";
import { fromLocalInput } from "../../lib/tz";
import { requireEventAccess } from "../events/events.service";
import { itemCode, type ItemCategory } from "../items/item-meta";
import { todayIn } from "../schedule/schedule-meta";
import { ARRIVAL_STATUSES, arrivalLate, type ArrivalStatus } from "./arrival-meta";

/**
 * Mapa de montagem (fase 5A): cada chegada de fornecedor, com horário,
 * veículo, doca, área, responsável e status. O banco cria uma chegada quando o
 * contrato é assinado; a Pré-produção completa e muda tudo. No campo, o
 * Gerente, o Head da área e o responsável só marcam o status (chegou,
 * montando, montado, retirado). Sem valores. A migration *_mapa_montagem
 * repete as regras (RLS e gatilho).
 */

/** Quem abre o mapa no campo: o Gerente/Admin, o Head e o Operacional (este vê só o que é dele). */
export function canSeeArrivals(actor: Actor, eventId: string) {
  if (canUsePreProduction(actor, eventId)) return true;
  if (!canUseField(actor, eventId)) return false;
  if (isEventAdmin(actor, eventId)) return true;
  const role = membershipFor(actor, eventId)?.role;
  return role === "GERENTE" || role === "HEAD" || role === "OPERACIONAL";
}

function requireSee(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canSeeArrivals(actor, eventId)) throw new NotFoundError("Mapa de montagem");
}

function requirePre(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canUsePreProduction(actor, eventId)) throw new NotFoundError("Pré-produção");
}

const select = {
  id: true, eventId: true, contractId: true, supplierName: true, scheduledAt: true, endsAt: true, vehicle: true, plate: true,
  driver: true, driverPhone: true, dock: true, areaId: true, responsibleId: true, notes: true, status: true,
  arrivedAt: true, statusAt: true,
  area: { select: { name: true } }, responsible: { select: { name: true } },
  arrivedBy: { select: { name: true } }, statusBy: { select: { name: true } },
  items: { orderBy: { name: "asc" }, select: { id: true, costItemId: true, name: true, quantity: true, unit: true } },
} as const;

/** As chegadas do evento que a pessoa vê (a RLS filtra por área e responsável), por dia. */
export async function listArrivals(actor: Actor, eventId: string, now = new Date()) {
  requireSee(actor, eventId);
  const edit = canUsePreProduction(actor, eventId);
  return actor.run(async (tx) => {
    const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { name: true, number: true, timezone: true } });
    const rows = await tx.arrival.findMany({ where: { eventId }, orderBy: [{ scheduledAt: { sort: "asc", nulls: "last" } }, { supplierName: "asc" }], select });
    const dayOf = (d: Date | null) => (d ? todayIn(event.timezone, d) : null);
    const items = rows.map((r) => ({
      ...r,
      status: r.status as ArrivalStatus,
      day: dayOf(r.scheduledAt),
      area: r.area?.name ?? null,
      responsible: r.responsible?.name ?? null,
      arrivedBy: r.arrivedBy?.name ?? null,
      statusBy: r.statusBy?.name ?? null,
      items: r.items.map((i) => ({ ...i, quantity: i.quantity === null ? null : Number(i.quantity) })),
      late: arrivalLate({ status: r.status as ArrivalStatus, scheduledAt: r.scheduledAt, endsAt: r.endsAt }, now),
    }));
    const days = [...new Set(items.map((i) => i.day).filter((d): d is string => !!d))].sort();
    return {
      eventName: event.name,
      timezone: event.timezone,
      today: todayIn(event.timezone, now),
      days,
      items,
      totals: {
        total: items.length,
        arrived: items.filter((i) => i.status !== "AGENDADO").length,
        done: items.filter((i) => i.status === "MONTADO" || i.status === "RETIRADO").length,
        late: items.filter((i) => i.late).length,
      },
      can: { edit },
      // Para o formulário da Pré-produção: áreas, pessoas do campo e itens do evento.
      ...(edit ? await pickers(tx, eventId, event.number) : { areas: [], people: [], costItems: [] }),
    };
  });
}

async function pickers(tx: Tx, eventId: string, eventNumber: number) {
  const [areas, people, costItems] = await Promise.all([
    tx.area.findMany({ where: { eventId, deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    fieldPeople(tx, eventId),
    tx.costItem.findMany({
      where: { eventId },
      orderBy: [{ section: { position: "asc" } }, { position: "asc" }],
      select: { id: true, name: true, number: true, category: true },
    }),
  ]);
  return {
    areas,
    people,
    costItems: costItems.map((i) => ({ id: i.id, name: `${itemCode(eventNumber, i.category as ItemCategory | null, i.number)} ${i.name}` })),
  };
}

const fieldPeople = (tx: Tx, eventId: string) =>
  tx.participant.findMany({
    where: { eventId, active: true, deletedAt: null, role: { in: ["GERENTE", "HEAD", "OPERACIONAL"] } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

/** Contagem para o painel do campo. */
export async function arrivalsSummary(actor: Actor, eventId: string, now = new Date()) {
  if (!canSeeArrivals(actor, eventId)) return null;
  const l = await listArrivals(actor, eventId, now);
  const today = l.items.filter((i) => i.day === l.today);
  return { ...l.totals, today: today.length, todayArrived: today.filter((i) => i.status !== "AGENDADO").length };
}

// ───────────────────────── Pré-produção: criar e mudar ─────────────────────────

const localTime = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Data e hora inválidas");
const arrivalSchema = z.object({
  supplierName: text(160),
  scheduledAt: localTime.nullable().optional(),
  endsAt: localTime.nullable().optional(),
  vehicle: optionalText(80),
  plate: optionalText(20),
  driver: optionalText(120),
  driverPhone: optionalText(30),
  dock: optionalText(80),
  areaId: uuid.nullable().optional(),
  responsibleId: uuid.nullable().optional(),
  notes: optionalText(1000),
  itemIds: z.array(uuid).max(200).optional(),
});
type ArrivalInput = z.infer<typeof arrivalSchema>;

async function toData(tx: Tx, eventId: string, d: Partial<ArrivalInput>) {
  const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { timezone: true } });
  const when = (v: string | null | undefined) => (v ? fromLocalInput(v, event.timezone) : null);
  if (d.areaId && !(await tx.area.findFirst({ where: { id: d.areaId, eventId, deletedAt: null }, select: { id: true } }))) {
    throw new ValidationError("Escolha uma área do evento", { areaId: ["Escolha uma área do evento"] });
  }
  if (d.responsibleId && !(await fieldPeople(tx, eventId)).some((p) => p.id === d.responsibleId)) {
    throw new ValidationError("Escolha alguém do campo", { responsibleId: ["Escolha alguém do campo"] });
  }
  const data = {
    ...(d.supplierName !== undefined && { supplierName: d.supplierName }),
    ...("scheduledAt" in d && { scheduledAt: when(d.scheduledAt) }),
    ...("endsAt" in d && { endsAt: when(d.endsAt) }),
    ...("vehicle" in d && { vehicle: d.vehicle ?? null }),
    ...("plate" in d && { plate: d.plate ? d.plate.toUpperCase() : null }),
    ...("driver" in d && { driver: d.driver ?? null }),
    ...("driverPhone" in d && { driverPhone: d.driverPhone ?? null }),
    ...("dock" in d && { dock: d.dock ?? null }),
    ...("areaId" in d && { areaId: d.areaId ?? null }),
    ...("responsibleId" in d && { responsibleId: d.responsibleId ?? null }),
    ...("notes" in d && { notes: d.notes ?? null }),
  };
  return data;
}

function checkPeriod(scheduledAt: Date | null | undefined, endsAt: Date | null | undefined) {
  if (scheduledAt && endsAt && endsAt < scheduledAt) throw new ValidationError("O fim da montagem é antes da chegada", { endsAt: ["O fim é antes da chegada"] });
}

async function setItems(tx: Tx, eventId: string, arrivalId: string, ids: string[]) {
  const items = await tx.costItem.findMany({ where: { eventId, id: { in: ids } }, select: { id: true, name: true, quantity: true, unit: true } });
  if (items.length !== new Set(ids).size) throw new ValidationError("Escolha itens deste evento", { itemIds: ["Escolha itens deste evento"] });
  await tx.arrivalItem.deleteMany({ where: { arrivalId, costItemId: { notIn: ids } } });
  const have = new Set((await tx.arrivalItem.findMany({ where: { arrivalId }, select: { costItemId: true } })).map((i) => i.costItemId));
  const add = items.filter((i) => !have.has(i.id));
  if (add.length) await tx.arrivalItem.createMany({ data: add.map((i) => ({ arrivalId, costItemId: i.id, name: i.name, quantity: i.quantity, unit: i.unit })) });
}

const AUDITED = ["supplierName", "scheduledAt", "endsAt", "vehicle", "plate", "driver", "driverPhone", "dock", "areaId", "responsibleId", "notes"] as const;
const auditable = (a: Record<(typeof AUDITED)[number], unknown>) => Object.fromEntries(AUDITED.map((k) => [k, a[k]]));

/** Nova chegada, feita à mão (as dos contratos o app cria sozinho). */
export async function createArrival(actor: Actor, eventId: string, input: unknown) {
  requirePre(actor, eventId);
  const d = parse(arrivalSchema, input);
  return actor.run(async (tx) => {
    const data = await toData(tx, eventId, d);
    checkPeriod(data.scheduledAt, data.endsAt);
    const a = await tx.arrival.create({ data: { eventId, supplierName: d.supplierName, ...data, createdById: actor.userId } });
    if (d.itemIds?.length) await setItems(tx, eventId, a.id, d.itemIds);
    await audit(tx, actor, { eventId, entity: "arrival", entityId: a.id, action: "CREATE", after: auditable(a) });
    return { id: a.id };
  });
}

async function loadArrival(actor: Actor, tx: Tx, id: string) {
  const a = uuid.safeParse(id).success ? await tx.arrival.findUnique({ where: { id } }) : null;
  if (!a || !canSeeArrivals(actor, a.eventId)) throw new NotFoundError("Chegada");
  return a;
}

export async function updateArrival(actor: Actor, id: string, input: unknown) {
  const d = parse(arrivalSchema.partial(), input);
  return actor.run(async (tx) => {
    const a = await loadArrival(actor, tx, id);
    if (!canUsePreProduction(actor, a.eventId)) throw new NotFoundError("Chegada");
    const data = await toData(tx, a.eventId, d);
    checkPeriod("scheduledAt" in data ? data.scheduledAt : a.scheduledAt, "endsAt" in data ? data.endsAt : a.endsAt);
    const updated = await tx.arrival.update({ where: { id: a.id }, data });
    if (d.itemIds) await setItems(tx, a.eventId, a.id, d.itemIds);
    await audit(tx, actor, { eventId: a.eventId, entity: "arrival", entityId: a.id, action: "UPDATE", ...diff(auditable(a), auditable(updated)) });
    return { id: a.id };
  });
}

export async function deleteArrival(actor: Actor, id: string) {
  return actor.run(async (tx) => {
    const a = await loadArrival(actor, tx, id);
    if (!canUsePreProduction(actor, a.eventId)) throw new NotFoundError("Chegada");
    await tx.arrival.delete({ where: { id: a.id } });
    await audit(tx, actor, { eventId: a.eventId, entity: "arrival", entityId: a.id, action: "DELETE", before: auditable(a) });
    return { ok: true };
  });
}

// ───────────────────────── Campo: o status ─────────────────────────

/** Chegou, montando, montado, retirado (ou voltar um passo). A hora de chegada fica no nome de quem marcou. */
export async function setArrivalStatus(actor: Actor, id: string, input: unknown) {
  const { status } = parse(z.object({ status: z.enum(ARRIVAL_STATUSES) }), input);
  return actor.run(async (tx) => {
    const a = await loadArrival(actor, tx, id);
    if (a.status === status) return { id: a.id, status };
    const now = new Date();
    const arrived = status === "AGENDADO" ? { arrivedAt: null, arrivedById: null } : a.arrivedAt ? {} : { arrivedAt: now, arrivedById: actor.userId };
    // A RLS some com a linha de quem não vê: o update não acha nada.
    const n = await tx.arrival.updateMany({ where: { id: a.id }, data: { status, statusAt: now, statusById: actor.userId, ...arrived } });
    if (n.count === 0) throw new NotFoundError("Chegada");
    await audit(tx, actor, { eventId: a.eventId, entity: "arrival", entityId: a.id, action: "STATUS_CHANGE", before: { status: a.status }, after: { status, supplier: a.supplierName } });
    return { id: a.id, status };
  });
}
