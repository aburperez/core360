import { z } from "zod";
import type { Actor, EventRole } from "../../server/authz/actor";
import { membershipFor } from "../../server/authz/actor";
import { canSeeEvent } from "../../server/authz/policy";
import { audit } from "../../server/audit/audit";
import { ForbiddenError, NotFoundError } from "../../server/errors";
import { optionalText, parse, text, uuid } from "../../lib/validation";
import { DEFAULT_SLA_MINUTES } from "../occurrences/sla";

/** Garante que o evento existe E está no escopo do usuário; senão, 404. */
export function requireEventAccess(actor: Actor, eventId: string): void {
  if (!uuid.safeParse(eventId).success || !canSeeEvent(actor, eventId)) {
    throw new NotFoundError("Evento");
  }
}

function myRole(actor: Actor, eventId: string): EventRole | "ADMIN" | null {
  return actor.isAdmin ? "ADMIN" : (membershipFor(actor, eventId)?.role ?? null);
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

const createEventSchema = z
  .object({
    clientId: uuid,
    name: text(),
    description: optionalText(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    venue: optionalText(200),
    address: optionalText(300),
  })
  .refine((v) => v.endsAt >= v.startsAt, { message: "Fim antes do início", path: ["endsAt"] });

/** Só ADMIN cria eventos (decisão padrão do MVP). Já cria as políticas de SLA. */
export async function createEvent(actor: Actor, input: unknown) {
  if (!actor.isAdmin) throw new ForbiddenError();
  const data = parse(createEventSchema, input);
  return actor.run(async (tx) => {
    const event = await tx.event.create({ data });
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
