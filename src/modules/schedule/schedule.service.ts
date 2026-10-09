import { z } from "zod";
import type { Actor } from "../../server/authz/actor";
import { canUsePreProduction } from "../../server/authz/policy";
import { audit, diff } from "../../server/audit/audit";
import { NotFoundError, ValidationError } from "../../server/errors";
import type { Tx } from "../../server/db/with-user";
import { parse, text, uuid } from "../../lib/validation";
import { requireEventAccess } from "../events/events.service";
import { ITEM_STATUSES, itemCode, type ItemCategory, type ItemStatus } from "../items/item-meta";
import { dueState, todayIn, tLabel } from "./schedule-meta";
import { assemblyDeadlines, itemAssembled } from "../arrivals/assembly";

/**
 * Cronograma do evento (fase 4A): os marcos de T-30 a T0 (o banco cria os
 * padrão quando o evento nasce) e os itens com prazo, com quem é o
 * responsável e o que está atrasado. Só a Pré-produção vê e mexe. A RLS e os
 * gatilhos da migration *_cronograma repetem as regras.
 */

function requirePre(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canUsePreProduction(actor, eventId)) throw new NotFoundError("Pré-produção");
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Item pronto para o cronograma: já chegou em Pronto (ou foi além). */
export const itemReady = (s: ItemStatus) => ITEM_STATUSES.indexOf(s) >= ITEM_STATUSES.indexOf("PRONTO");

/** Quem pode ser responsável por um marco: as pessoas ativas do evento, sem o cliente. */
async function people(tx: Tx, eventId: string) {
  return tx.participant.findMany({
    where: { eventId, active: true, deletedAt: null, role: { not: "CLIENTE" } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  });
}

export async function getSchedule(actor: Actor, eventId: string, now = new Date()) {
  requirePre(actor, eventId);
  return actor.run(async (tx) => {
    const event = await tx.event.findUniqueOrThrow({
      where: { id: eventId },
      select: { name: true, number: true, startsAt: true, endsAt: true, timezone: true, status: true },
    });
    const deadlines = await assemblyDeadlines(tx, eventId, event.startsAt);
    const [milestones, items, team] = await Promise.all([
      tx.eventMilestone.findMany({
        where: { eventId },
        orderBy: [{ dueOn: "asc" }, { createdAt: "asc" }],
        select: {
          id: true, title: true, dueOn: true, responsibleId: true, doneAt: true,
          responsible: { select: { name: true } }, doneBy: { select: { name: true } },
        },
      }),
      tx.costItem.findMany({
        where: { eventId, OR: [{ neededOn: { not: null } }, { dependsOnId: { not: null } }, { id: { in: [...deadlines.keys()] } }] },
        orderBy: [{ neededOn: "asc" }, { number: "asc" }],
        select: {
          id: true, name: true, number: true, category: true, status: true, neededOn: true,
          area: { select: { name: true } }, responsible: { select: { name: true } },
          dependsOn: { select: { id: true, name: true, number: true, category: true, status: true, neededOn: true } },
        },
      }),
      people(tx, eventId),
    ]);
    const today = todayIn(event.timezone, now);
    const eventDay = todayIn(event.timezone, event.startsAt);
    const code = (i: { number: number; category: unknown }) => itemCode(event.number, i.category as ItemCategory | null, i.number);
    const ms = milestones.map((m) => {
      const due = iso(m.dueOn);
      return {
        id: m.id, title: m.title, dueOn: due, t: tLabel(eventDay, due), state: dueState(due, today, !!m.doneAt),
        responsibleId: m.responsibleId, responsible: m.responsible?.name ?? null, doneAt: m.doneAt, doneBy: m.doneBy?.name ?? null,
      };
    });
    // Fase 5B: item do mapa de montagem que passou do prazo sem estar Montado.
    const assembly = (id: string, status: ItemStatus) => {
      const until = deadlines.get(id);
      if (!until) return null;
      const done = itemAssembled(status);
      return { until: until.toISOString(), done, late: !done && until < now };
    };
    const its = items.map((i) => {
      const due = i.neededOn ? iso(i.neededOn) : null;
      const ready = itemReady(i.status);
      const dep = i.dependsOn && {
        id: i.dependsOn.id, code: code(i.dependsOn), name: i.dependsOn.name, ready: itemReady(i.dependsOn.status),
        neededOn: i.dependsOn.neededOn ? iso(i.dependsOn.neededOn) : null,
      };
      return {
        id: i.id, code: code(i), name: i.name, status: i.status, ready, dueOn: due,
        t: due ? tLabel(eventDay, due) : null, state: due ? dueState(due, today, ready) : null,
        area: i.area?.name ?? null, responsible: i.responsible?.name ?? null,
        dependsOn: dep,
        /** A dependência ainda não está pronta. */
        waiting: !!dep && !dep.ready && !ready,
        /** A dependência tem prazo depois do prazo deste item. */
        dependencyLate: !!dep && !!due && !!dep.neededOn && dep.neededOn > due,
        assembly: assembly(i.id, i.status),
      };
    });
    const done = ms.filter((m) => m.state === "FEITO").length;
    return {
      eventName: event.name, eventDay, today, todayT: tLabel(eventDay, today),
      milestones: ms, items: its,
      progress: { done, total: ms.length, pct: ms.length ? Math.round((done / ms.length) * 100) : 0 },
      late: ms.filter((m) => m.state === "ATRASADO").length + its.filter((i) => i.state === "ATRASADO" || i.assembly?.late).length,
      assemblyLate: its.filter((i) => i.assembly?.late).length,
      people: team,
    };
  });
}

const day = z.iso.date({ message: "Data inválida" });
const milestoneSchema = z.object({
  title: text(120),
  dueOn: day,
  responsibleId: uuid.nullable().optional(),
});

async function checkResponsible(tx: Tx, eventId: string, responsibleId: string | null | undefined) {
  if (!responsibleId) return;
  const ok = (await people(tx, eventId)).some((p) => p.id === responsibleId);
  if (!ok) throw new ValidationError("Escolha alguém do evento", { responsibleId: ["Escolha alguém do evento"] });
}

const toDate = (d: string) => new Date(`${d}T00:00:00.000Z`);
const auditable = (m: { title: string; dueOn: Date; responsibleId: string | null; doneAt?: Date | null }) =>
  ({ title: m.title, dueOn: iso(m.dueOn), responsibleId: m.responsibleId, ...(m.doneAt !== undefined && { done: !!m.doneAt }) });

async function loadMilestone(actor: Actor, tx: Tx, id: string) {
  const m = uuid.safeParse(id).success ? await tx.eventMilestone.findUnique({ where: { id } }) : null;
  if (!m || !canUsePreProduction(actor, m.eventId)) throw new NotFoundError("Marco");
  return m;
}

/** Novo marco no cronograma. */
export async function createMilestone(actor: Actor, eventId: string, input: unknown) {
  requirePre(actor, eventId);
  const data = parse(milestoneSchema, input);
  return actor.run(async (tx) => {
    await checkResponsible(tx, eventId, data.responsibleId);
    const m = await tx.eventMilestone.create({
      data: { eventId, title: data.title, dueOn: toDate(data.dueOn), responsibleId: data.responsibleId ?? null, createdById: actor.userId },
    });
    await audit(tx, actor, { eventId, entity: "event_milestone", entityId: m.id, action: "CREATE", after: auditable(m) });
    return { id: m.id };
  });
}

/** Muda nome, data ou responsável. */
export async function updateMilestone(actor: Actor, id: string, input: unknown) {
  const data = parse(milestoneSchema.partial(), input);
  return actor.run(async (tx) => {
    const m = await loadMilestone(actor, tx, id);
    if ("responsibleId" in data) await checkResponsible(tx, m.eventId, data.responsibleId);
    const updated = await tx.eventMilestone.update({
      where: { id: m.id },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.dueOn !== undefined && { dueOn: toDate(data.dueOn) }),
        ...("responsibleId" in data && { responsibleId: data.responsibleId ?? null }),
      },
    });
    await audit(tx, actor, { eventId: m.eventId, entity: "event_milestone", entityId: m.id, action: "UPDATE", ...diff(auditable(m), auditable(updated)) });
    return { id: m.id };
  });
}

/** Marcar como feito (fica no nome de quem marcou) ou desmarcar. */
export async function setMilestoneDone(actor: Actor, id: string, input: unknown) {
  const { done } = parse(z.object({ done: z.boolean() }), input);
  return actor.run(async (tx) => {
    const m = await loadMilestone(actor, tx, id);
    if (!!m.doneAt === done) return { id: m.id, done };
    await tx.eventMilestone.update({
      where: { id: m.id },
      data: done ? { doneAt: new Date(), doneById: actor.userId } : { doneAt: null, doneById: null },
    });
    await audit(tx, actor, { eventId: m.eventId, entity: "event_milestone", entityId: m.id, action: "STATUS_CHANGE", before: { done: !done }, after: { done, title: m.title } });
    return { id: m.id, done };
  });
}

export async function deleteMilestone(actor: Actor, id: string) {
  return actor.run(async (tx) => {
    const m = await loadMilestone(actor, tx, id);
    await tx.eventMilestone.delete({ where: { id: m.id } });
    await audit(tx, actor, { eventId: m.eventId, entity: "event_milestone", entityId: m.id, action: "DELETE", before: auditable(m) });
    return { ok: true };
  });
}

/** Evento sem marcos (criado antes do cronograma): cria os padrão, de T-30 a T0. */
export async function createDefaultMilestones(actor: Actor, eventId: string) {
  requirePre(actor, eventId);
  return actor.run(async (tx) => {
    const [{ n }] = await tx.$queryRaw<{ n: number }[]>`SELECT app.create_default_milestones(${eventId}::uuid) AS n`;
    if (n > 0) await audit(tx, actor, { eventId, entity: "event_milestone", entityId: eventId, action: "CREATE", after: { defaults: n } });
    return { created: n };
  });
}
