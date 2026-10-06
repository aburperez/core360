import { z } from "zod";
import type { Actor } from "../../server/authz/actor";
import { canManageAreas, canSeeArea } from "../../server/authz/policy";
import { audit } from "../../server/audit/audit";
import { ForbiddenError, NotFoundError, ValidationError } from "../../server/errors";
import { optionalText, parse, text, uuid } from "../../lib/validation";
import { requireEventAccess } from "../events/events.service";
import { isUniqueViolation } from "../../server/db/errors";

export async function listAreas(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  const areas = await actor.run((tx) =>
    tx.area.findMany({
      where: { eventId, deletedAt: null },
      orderBy: { name: "asc" },
      include: { _count: { select: { teams: { where: { deletedAt: null } } } } },
    }),
  );
  return areas.filter((a) => canSeeArea(actor, { eventId, areaId: a.id }));
}

export async function getArea(actor: Actor, areaId: string) {
  const area = uuid.safeParse(areaId).success
    ? await actor.run((tx) => tx.area.findFirst({ where: { id: areaId, deletedAt: null } }))
    : null;
  if (!area || !canSeeArea(actor, { eventId: area.eventId, areaId: area.id })) throw new NotFoundError("Área");
  return area;
}

const createAreaSchema = z.object({ eventId: uuid, name: text(80), description: optionalText() });

export async function createArea(actor: Actor, input: unknown) {
  const data = parse(createAreaSchema, input);
  requireEventAccess(actor, data.eventId);
  if (!canManageAreas(actor, data.eventId)) throw new ForbiddenError();
  try {
    return await actor.run(async (tx) => {
      const area = await tx.area.create({ data });
      await audit(tx, actor, { eventId: data.eventId, entity: "area", entityId: area.id, action: "CREATE", after: data });
      return area;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ValidationError(`Já existe uma área "${data.name}" neste evento`);
    throw e;
  }
}
