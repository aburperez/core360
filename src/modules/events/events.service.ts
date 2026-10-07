import { z } from "zod";
import type { Actor, EventRole } from "../../server/authz/actor";
import { isAgencyAdmin, isEventAdmin, membershipFor } from "../../server/authz/actor";
import { canSeeEvent } from "../../server/authz/policy";
import { audit, diff } from "../../server/audit/audit";
import { ForbiddenError, NotFoundError, ValidationError } from "../../server/errors";
import { optionalText, parse, text, uuid } from "../../lib/validation";
import { DEFAULT_SLA_MINUTES } from "../occurrences/sla";
import { DEFAULT_TZ, fromLocalInput } from "../../lib/tz";

/** Garante que o evento existe E está no escopo do usuário; senão, 404. */
export function requireEventAccess(actor: Actor, eventId: string): void {
  if (!uuid.safeParse(eventId).success || !canSeeEvent(actor, eventId)) {
    throw new NotFoundError("Evento");
  }
}

function myRole(actor: Actor, eventId: string): EventRole | "ADMIN" | null {
  return isEventAdmin(actor, eventId) ? "ADMIN" : (membershipFor(actor, eventId)?.role ?? null);
}

export async function listEvents(actor: Actor) {
  const events = await actor.run((tx) =>
    tx.event.findMany({
      where: { deletedAt: null },
      orderBy: { startsAt: "asc" },
      include: { client: { select: { id: true, name: true } } },
    }),
  );
  return events.map((e) => ({ ...e, myRole: myRole(actor, e.id) }));
}

export async function getEvent(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  const event = await actor.run((tx) =>
    tx.event.findFirst({
      where: { id: eventId, deletedAt: null },
      include: { client: { select: { id: true, name: true } } },
    }),
  );
  if (!event) throw new NotFoundError("Evento");
  const managers = await actor.run((tx) =>
    tx.participant.findMany({
      where: { eventId, role: "GERENTE", active: true, deletedAt: null },
      select: { id: true, name: true, phone: true, email: true },
    }),
  );
  return { ...event, managers, myRole: myRole(actor, eventId) };
}

/**
 * Data e hora: instante ISO, ou "2027-04-10T12:00" (campo da tela, sem fuso),
 * que vale no fuso do evento.
 */
const when = (timeZone = DEFAULT_TZ) =>
  z.preprocess(
    (v) => (typeof v === "string" ? (fromLocalInput(v, timeZone) ?? v) : v),
    z.coerce.date({ message: "Data inválida" }),
  );

const createEventSchema = z
  .object({
    clientId: uuid,
    name: text(),
    description: optionalText(),
    startsAt: when(),
    endsAt: when(),
    venue: optionalText(200),
    address: optionalText(300),
  })
  .refine((v) => v.endsAt >= v.startsAt, { message: "Fim antes do início", path: ["endsAt"] });

/**
 * Só o Admin da agência cria eventos, para clientes da própria agência. O
 * evento herda a agência do cliente. Já cria as políticas de SLA.
 */
export async function createEvent(actor: Actor, input: unknown) {
  if (!isAgencyAdmin(actor)) throw new ForbiddenError();
  const data = parse(createEventSchema, input);
  return actor.run(async (tx) => {
    const client = await tx.client.findFirst({ where: { id: data.clientId, deletedAt: null }, select: { agencyId: true, status: true } });
    if (!client || !isAgencyAdmin(actor, client.agencyId)) throw new NotFoundError("Cliente");
    if (client.status !== "ACTIVE") throw new ValidationError("Este cliente está desativado");
    const event = await tx.event.create({ data: { ...data, agencyId: client.agencyId } });
    await tx.slaPolicy.createMany({
      data: Object.entries(DEFAULT_SLA_MINUTES).map(([priority, targetMinutes]) => ({
        eventId: event.id,
        priority: priority as keyof typeof DEFAULT_SLA_MINUTES,
        targetMinutes,
      })),
    });
    await audit(tx, actor, { eventId: event.id, entity: "event", entityId: event.id, action: "CREATE", after: data });
    return event;
  });
}

const STATUSES = ["PLANEJAMENTO", "PRE_PRODUCAO", "MONTAGEM", "OPERACAO", "DESMONTAGEM", "FINALIZADO", "CANCELADO"] as const;

const updateEventSchema = z.object({
  name: text().optional(),
  description: optionalText(),
  startsAt: z.string().or(z.date()).optional(),
  endsAt: z.string().or(z.date()).optional(),
  venue: optionalText(200),
  address: optionalText(300),
  status: z.enum(STATUSES).optional(),
});

/** Dados e fase do evento: o Admin da agência ou o Gerente do evento. */
export async function updateEvent(actor: Actor, eventId: string, input: unknown) {
  requireEventAccess(actor, eventId);
  if (!isEventAdmin(actor, eventId) && membershipFor(actor, eventId)?.role !== "GERENTE") throw new ForbiddenError();
  const { startsAt: rawStart, endsAt: rawEnd, ...rest } = parse(updateEventSchema, input);
  // Campo que não veio fica como está (os opcionais de texto viram null sem isso).
  const raw = (input ?? {}) as Record<string, unknown>;
  return actor.run(async (tx) => {
    const found = await tx.event.findFirst({
      where: { id: eventId, deletedAt: null },
      select: { name: true, description: true, startsAt: true, endsAt: true, venue: true, address: true, status: true, timezone: true },
    });
    if (!found) throw new NotFoundError("Evento");
    const { timezone, ...before } = found;
    const at = (v: string | Date | undefined) => (v === undefined ? undefined : parse(when(timezone), v));
    const data = {
      ...Object.fromEntries(Object.entries(rest).filter(([k]) => k in raw)),
      ...(rawStart !== undefined && { startsAt: at(rawStart) }),
      ...(rawEnd !== undefined && { endsAt: at(rawEnd) }),
    } as Partial<typeof before>;
    const startsAt = data.startsAt ?? before.startsAt;
    const endsAt = data.endsAt ?? before.endsAt;
    if (endsAt < startsAt) throw new ValidationError("O fim não pode ser antes do início");
    const changes = diff(before, data);
    if (!Object.keys(changes.after).length) return { id: eventId };
    await tx.event.update({ where: { id: eventId }, data });
    await audit(tx, actor, { eventId, entity: "event", entityId: eventId, action: "UPDATE", ...changes });
    return { id: eventId };
  });
}
