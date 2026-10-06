import { z } from "zod";
import type { Actor } from "../../server/authz/actor";
import { canManageTeams, canSeeTeam } from "../../server/authz/policy";
import { audit } from "../../server/audit/audit";
import { ForbiddenError, NotFoundError, ValidationError } from "../../server/errors";
import { optionalText, parse, text, uuid } from "../../lib/validation";
import { getArea } from "../areas/areas.service";
import { requireEventAccess } from "../events/events.service";
import { isUniqueViolation } from "../../server/db/errors";

export async function listTeams(actor: Actor, eventId: string, areaId?: string) {
  requireEventAccess(actor, eventId);
  const teams = await actor.run((tx) =>
    tx.team.findMany({
      where: { eventId, deletedAt: null, ...(areaId ? { areaId } : {}) },
      orderBy: [{ area: { name: "asc" } }, { name: "asc" }],
      include: {
        area: { select: { id: true, name: true } },
        _count: { select: { participants: { where: { active: true, deletedAt: null } } } },
      },
    }),
  );
  return teams.filter((t) => canSeeTeam(actor, { eventId, areaId: t.areaId, teamId: t.id }));
}

export async function getTeam(actor: Actor, teamId: string) {
  const team = uuid.safeParse(teamId).success
    ? await actor.run((tx) => tx.team.findFirst({ where: { id: teamId, deletedAt: null } }))
    : null;
  if (!team || !canSeeTeam(actor, { eventId: team.eventId, areaId: team.areaId, teamId: team.id })) {
    throw new NotFoundError("Equipe");
  }
  return team;
}

const createTeamSchema = z.object({ areaId: uuid, name: text(80), description: optionalText() });

/** O evento vem da área (lida no servidor), nunca do formulário. */
export async function createTeam(actor: Actor, input: unknown) {
  const data = parse(createTeamSchema, input);
  const area = await getArea(actor, data.areaId);
  requireEventAccess(actor, area.eventId);
  if (!canManageTeams(actor, { eventId: area.eventId, areaId: area.id })) throw new ForbiddenError();
  try {
    return await actor.run(async (tx) => {
      const team = await tx.team.create({ data: { ...data, eventId: area.eventId } });
      await audit(tx, actor, { eventId: area.eventId, entity: "team", entityId: team.id, action: "CREATE", after: data });
      return team;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ValidationError(`Já existe uma equipe "${data.name}" nesta área`);
    throw e;
  }
}
