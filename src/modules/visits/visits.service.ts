import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client";
import type { Actor } from "../../server/authz/actor";
import { membershipFor } from "../../server/authz/actor";
import { canReviewSla, canUsePreProduction } from "../../server/authz/policy";
import { audit, diff } from "../../server/audit/audit";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../server/errors";
import type { Tx } from "../../server/db/with-user";
import { optionalText, parse, text, uuid } from "../../lib/validation";
import { fromLocalInput } from "../../lib/tz";
import { requireEventAccess } from "../events/events.service";
import { PPE_OPTIONS } from "./ppe";

/**
 * Pré-produção: visita técnica ao local. Quem vai (Gerente ou Pré-produtor do
 * evento) põe data, horário e os EPIs necessários. Toda a Pré-produção vê e
 * marca visitas; mudar ou apagar é do gestor, de quem marcou e de quem vai.
 * A RLS e o gatilho da migration *_visita_tecnica repetem as regras.
 */

function requirePre(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canUsePreProduction(actor, eventId)) throw new NotFoundError("Pré-produção");
}

const visitSelect = {
  id: true, eventId: true, title: true, place: true, scheduledAt: true, responsibleId: true,
  ppe: true, ppeOther: true, notes: true, createdById: true, createdAt: true, updatedAt: true,
  status: true, concludedAt: true, _count: { select: { photos: true } },
  responsible: { select: { id: true, name: true, role: true, phone: true } },
  createdBy: { select: { name: true } },
} satisfies Prisma.TechnicalVisitSelect;

type VisitRow = Prisma.TechnicalVisitGetPayload<{ select: typeof visitSelect }>;

/** Pode mudar ou apagar (e preencher o relatório): o gestor, quem marcou ou quem vai. */
export function canEdit(actor: Actor, v: { eventId: string; createdById: string; responsibleId: string }) {
  return canReviewSla(actor, v.eventId)
    || v.createdById === actor.userId
    || membershipFor(actor, v.eventId)?.participantId === v.responsibleId;
}

/** Concluída, a visita fica travada até alguém reabrir. */
export function requireOpen(v: { status: string }) {
  if (v.status === "CONCLUIDA") throw new ConflictError("Visita concluída. Para mudar, reabra a visita.");
}

async function load(actor: Actor, tx: Tx, id: string) {
  const v = uuid.safeParse(id).success ? await tx.technicalVisit.findUnique({ where: { id }, select: visitSelect }) : null;
  if (!v || !canUsePreProduction(actor, v.eventId)) throw new NotFoundError("Visita técnica");
  return v;
}

/** Quem pode ir: Gerente ou Pré-produtor ativo do evento. */
async function pickers(tx: Tx, eventId: string) {
  return tx.participant.findMany({
    where: { eventId, deletedAt: null, active: true, role: { in: ["GERENTE", "PRE_PRODUTOR"] } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  });
}

async function checkResponsible(tx: Tx, eventId: string, responsibleId: string | undefined) {
  if (!responsibleId) return;
  const p = await tx.participant.findFirst({
    where: { id: responsibleId, eventId, deletedAt: null, active: true, role: { in: ["GERENTE", "PRE_PRODUTOR"] } },
    select: { id: true },
  });
  if (!p) throw new ValidationError("Quem vai à visita precisa ser Gerente ou Pré-produtor do evento");
}

/** Data e hora: instante ISO, ou "2027-04-10T09:30" (campo da tela), no fuso do evento. */
const when = (timeZone: string) =>
  z.preprocess(
    (v) => (typeof v === "string" ? (fromLocalInput(v, timeZone) ?? v) : v),
    z.coerce.date({ message: "Data e horário inválidos" }),
  );

const ppeList = z
  .array(z.enum(PPE_OPTIONS, { message: "EPI fora da lista" }))
  .max(PPE_OPTIONS.length)
  .transform((list) => PPE_OPTIONS.filter((p) => list.includes(p)));

const visitSchema = (timeZone: string) => z.object({
  title: text(120),
  place: optionalText(200),
  scheduledAt: when(timeZone),
  responsibleId: uuid,
  ppe: ppeList.default([]),
  ppeOther: optionalText(500),
  notes: optionalText(4000),
});

async function eventTimeZone(tx: Tx, eventId: string) {
  const e = await tx.event.findFirst({ where: { id: eventId, deletedAt: null }, select: { timezone: true } });
  if (!e) throw new NotFoundError("Evento");
  return e.timezone;
}

const toVisit = (actor: Actor, { _count, ...v }: VisitRow) => ({ ...v, photos: _count.photos, canEdit: canEdit(actor, v) });

/** Visitas do evento (próximas primeiro, depois as que já passaram) e quem pode ir. */
export async function listVisits(actor: Actor, eventId: string, now = new Date()) {
  requirePre(actor, eventId);
  return actor.run(async (tx) => {
    const [rows, people] = await Promise.all([
      tx.technicalVisit.findMany({ where: { eventId }, orderBy: [{ scheduledAt: "asc" }], select: visitSelect }),
      pickers(tx, eventId),
    ]);
    const visits = rows.map((v) => toVisit(actor, v));
    return {
      upcoming: visits.filter((v) => v.scheduledAt >= now),
      past: visits.filter((v) => v.scheduledAt < now).reverse(),
      people,
      me: membershipFor(actor, eventId)?.participantId ?? null,
    };
  });
}

/** Para o painel da pré-produção: quantas visitas e a próxima. */
export async function visitsSummary(actor: Actor, eventId: string, now = new Date()) {
  requirePre(actor, eventId);
  return actor.run(async (tx) => {
    const [total, next] = await Promise.all([
      tx.technicalVisit.count({ where: { eventId } }),
      tx.technicalVisit.findFirst({
        where: { eventId, scheduledAt: { gte: now } },
        orderBy: { scheduledAt: "asc" },
        select: { id: true, title: true, scheduledAt: true, responsible: { select: { name: true } } },
      }),
    ]);
    return { total, next };
  });
}

/** Nova visita técnica. O evento vem da URL; quem vai precisa ser da Pré-produção dele. */
export async function createVisit(actor: Actor, eventId: string, input: unknown) {
  requirePre(actor, eventId);
  return actor.run(async (tx) => {
    const data = parse(visitSchema(await eventTimeZone(tx, eventId)), input);
    await checkResponsible(tx, eventId, data.responsibleId);
    const v = await tx.technicalVisit.create({ data: { ...data, eventId, createdById: actor.userId }, select: visitSelect });
    await audit(tx, actor, {
      eventId, entity: "technical_visit", entityId: v.id, action: "CREATE",
      after: { title: v.title, scheduledAt: v.scheduledAt, responsibleId: v.responsibleId, ppe: v.ppe },
    });
    return toVisit(actor, v);
  });
}

/** Mudar a visita (só os campos enviados): o gestor, quem marcou ou quem vai. */
export async function updateVisit(actor: Actor, id: string, input: unknown) {
  return actor.run(async (tx) => {
    const v = await load(actor, tx, id);
    if (!canEdit(actor, v)) throw new ForbiddenError("Só o gestor, quem marcou ou quem vai muda a visita");
    requireOpen(v);
    const data = parse(visitSchema(await eventTimeZone(tx, v.eventId)).partial(), input);
    const sent = (input ?? {}) as Record<string, unknown>;
    const patch = Object.fromEntries(Object.entries(data).filter(([k]) => k in sent)) as Partial<typeof data>;
    if (patch.ppe && patch.ppe.join("|") === v.ppe.join("|")) delete patch.ppe;
    await checkResponsible(tx, v.eventId, patch.responsibleId);
    const changes = diff(v as unknown as Record<string, unknown>, patch);
    if (!Object.keys(changes.after).length) return toVisit(actor, v);
    const updated = await tx.technicalVisit.update({ where: { id: v.id }, data: patch, select: visitSelect });
    await audit(tx, actor, { eventId: v.eventId, entity: "technical_visit", entityId: v.id, action: "UPDATE", ...changes });
    return toVisit(actor, updated);
  });
}

export async function deleteVisit(actor: Actor, id: string) {
  return actor.run(async (tx) => {
    const v = await load(actor, tx, id);
    if (!canEdit(actor, v)) throw new ForbiddenError("Só o gestor, quem marcou ou quem vai apaga a visita");
    requireOpen(v);
    await tx.technicalVisit.delete({ where: { id: v.id } });
    await audit(tx, actor, {
      eventId: v.eventId, entity: "technical_visit", entityId: v.id, action: "DELETE",
      before: { title: v.title, scheduledAt: v.scheduledAt, responsibleId: v.responsibleId },
    });
    return { id: v.id };
  });
}
