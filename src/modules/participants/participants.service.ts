import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client";
import type { AuditAction, ParticipantRole } from "../../generated/prisma/enums";
import { membershipFor, type Actor } from "../../server/authz/actor";
import { assignableRoles, canAssignRole } from "../../server/authz/policy";
import { audit, diff } from "../../server/audit/audit";
import { ForbiddenError, NotFoundError, ValidationError } from "../../server/errors";
import { isUniqueViolation } from "../../server/db/errors";
import { optionalText, parse, text, uuid } from "../../lib/validation";
import { requireEventAccess } from "../events/events.service";
import { getTeam } from "../teams/teams.service";
import { getArea } from "../areas/areas.service";
import { hashToken, newToken } from "../../lib/tokens";

const ROLES = ["GERENTE", "HEAD", "OPERACIONAL", "CLIENTE"] as const;
export const INVITE_TTL_DAYS = 7;

const publicFields = {
  id: true, eventId: true, userId: true, name: true, email: true, phone: true, jobTitle: true,
  role: true, areaId: true, teamId: true, active: true, invitedAt: true, joinedAt: true,
  area: { select: { id: true, name: true } },
  team: { select: { id: true, name: true } },
} satisfies Prisma.ParticipantSelect;

/** Filtro de escopo no backend (a RLS do banco aplica o mesmo perímetro). */
function scopeWhere(actor: Actor, eventId: string): Prisma.ParticipantWhereInput {
  if (actor.isAdmin) return { eventId };
  const m = membershipFor(actor, eventId);
  switch (m?.role) {
    case "GERENTE":
    case "CLIENTE":
      return { eventId };
    case "HEAD":
      return { eventId, OR: [{ areaId: m.areaId }, { userId: actor.userId }] };
    case "OPERACIONAL":
      return { eventId, OR: [{ teamId: m.teamId }, { userId: actor.userId }] };
    default:
      return { id: { in: [] } };
  }
}

export async function listParticipants(
  actor: Actor,
  eventId: string,
  filter: { areaId?: string; teamId?: string; includeInactive?: boolean } = {},
) {
  requireEventAccess(actor, eventId);
  return actor.run((tx) =>
    tx.participant.findMany({
      where: {
        AND: [
          scopeWhere(actor, eventId),
          { deletedAt: null },
          filter.includeInactive ? {} : { active: true },
          filter.areaId ? { areaId: filter.areaId } : {},
          filter.teamId ? { teamId: filter.teamId } : {},
        ],
      },
      orderBy: [{ role: "asc" }, { name: "asc" }],
      select: publicFields,
    }),
  );
}

async function loadParticipant(actor: Actor, id: string) {
  const p = uuid.safeParse(id).success
    ? await actor.run((tx) =>
        tx.participant.findFirst({ where: { AND: [{ id, deletedAt: null }] }, select: { ...publicFields, createdById: true } }),
      )
    : null;
  if (!p) throw new NotFoundError("Participante");
  // Precisa estar no escopo de leitura do usuário.
  const visible = await actor.run((tx) =>
    tx.participant.count({ where: { AND: [{ id }, scopeWhere(actor, p.eventId)] } }),
  );
  if (!visible) throw new NotFoundError("Participante");
  return p;
}

/**
 * Resolve área/equipe a partir do que foi enviado, sempre relendo no servidor:
 * a área vem da equipe, e as duas precisam estar no mesmo evento e visíveis.
 */
async function resolvePlacement(
  actor: Actor,
  eventId: string,
  areaId: string | null | undefined,
  teamId: string | null | undefined,
) {
  if (teamId) {
    const team = await getTeam(actor, teamId);
    if (team.eventId !== eventId) throw new NotFoundError("Equipe");
    if (areaId && areaId !== team.areaId) throw new ValidationError("A equipe não pertence a esta área");
    return { areaId: team.areaId, teamId: team.id };
  }
  if (areaId) {
    const area = await getArea(actor, areaId);
    if (area.eventId !== eventId) throw new NotFoundError("Área");
    return { areaId: area.id, teamId: null };
  }
  return { areaId: null, teamId: null };
}

function checkRoleShape(role: ParticipantRole, areaId: string | null, teamId: string | null) {
  if (role === "HEAD" && !areaId) throw new ValidationError("Head precisa de uma área");
  if (role === "OPERACIONAL" && !teamId) throw new ValidationError("Operacional precisa de uma equipe");
}

const createSchema = z.object({
  eventId: uuid,
  name: text(120),
  email: z.email({ message: "E-mail inválido" }).trim().toLowerCase(),
  phone: optionalText(30),
  jobTitle: optionalText(80),
  role: z.enum(ROLES),
  areaId: uuid.optional().nullable(),
  teamId: uuid.optional().nullable(),
});

/** "Montar equipe": adiciona uma pessoa ao evento com um papel permitido. */
export async function createParticipant(actor: Actor, input: unknown) {
  const data = parse(createSchema, input);
  requireEventAccess(actor, data.eventId);
  const placement = await resolvePlacement(actor, data.eventId, data.areaId, data.teamId);
  checkRoleShape(data.role, placement.areaId, placement.teamId);

  if (!canAssignRole(actor, { eventId: data.eventId, areaId: placement.areaId, role: data.role })) {
    throw new ForbiddenError(`Você não pode cadastrar alguém como ${data.role}`);
  }

  try {
    return await actor.run(async (tx) => {
      const p = await tx.participant.create({
        data: { ...data, ...placement, createdById: actor.userId },
        select: publicFields,
      });
      await audit(tx, actor, {
        eventId: data.eventId, entity: "participant", entityId: p.id, action: "CREATE",
        after: { ...data, ...placement },
      });
      return p;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ValidationError("Este e-mail já está cadastrado neste evento");
    throw e;
  }
}

const updateSchema = z.object({
  name: text(120).optional(),
  phone: optionalText(30),
  jobTitle: optionalText(80),
  role: z.enum(ROLES).optional(),
  areaId: uuid.optional().nullable(),
  teamId: uuid.optional().nullable(),
  active: z.boolean().optional(),
});

export async function updateParticipant(actor: Actor, participantId: string, input: unknown) {
  const patch = parse(updateSchema, input);
  const current = await loadParticipant(actor, participantId);

  if (current.userId === actor.userId && !actor.isAdmin) {
    throw new ForbiddenError("Você não pode alterar a sua própria participação");
  }
  // Precisa poder gerenciar o papel ATUAL e o NOVO.
  if (!canAssignRole(actor, { eventId: current.eventId, areaId: current.areaId, role: current.role })) {
    throw new ForbiddenError();
  }

  const role = patch.role ?? current.role;
  const placementChanged = patch.areaId !== undefined || patch.teamId !== undefined;
  const placement = placementChanged
    ? await resolvePlacement(
        actor,
        current.eventId,
        patch.areaId === undefined ? current.areaId : patch.areaId,
        patch.teamId === undefined ? (patch.areaId !== undefined ? null : current.teamId) : patch.teamId,
      )
    : { areaId: current.areaId, teamId: current.teamId };
  checkRoleShape(role, placement.areaId, placement.teamId);
  if (!canAssignRole(actor, { eventId: current.eventId, areaId: placement.areaId, role })) {
    throw new ForbiddenError(`Você não pode atribuir o papel ${role}`);
  }

  const data = {
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.phone !== undefined && { phone: patch.phone }),
    ...(patch.jobTitle !== undefined && { jobTitle: patch.jobTitle }),
    ...(patch.active !== undefined && { active: patch.active }),
    role,
    ...placement,
  };
  const changes = diff(current as unknown as Record<string, unknown>, data);
  if (!Object.keys(changes.after).length) return current;

  const action: AuditAction =
    "role" in changes.after ? "ROLE_CHANGE"
    : "teamId" in changes.after || "areaId" in changes.after ? "TEAM_CHANGE"
    : "active" in changes.after ? (data.active ? "ACTIVATE" : "DEACTIVATE")
    : "UPDATE";

  return actor.run(async (tx) => {
    const p = await tx.participant.update({ where: { id: participantId }, data, select: publicFields });
    await audit(tx, actor, { eventId: current.eventId, entity: "participant", entityId: p.id, action, ...changes });
    return p;
  });
}

/**
 * Gera um link de convite. O token aparece só nesta resposta; o banco guarda o hash.
 * Pode ser enviado por e-mail ou copiado para o WhatsApp.
 */
export async function createInvitation(actor: Actor, participantId: string) {
  const p = await loadParticipant(actor, participantId);
  if (!canAssignRole(actor, { eventId: p.eventId, areaId: p.areaId, role: p.role })) throw new ForbiddenError();
  if (!p.active) throw new ValidationError("Participante inativo");

  const token = newToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600_000);
  await actor.run(async (tx) => {
    await tx.invitation.create({
      data: { eventId: p.eventId, participantId: p.id, tokenHash: hashToken(token), expiresAt, createdById: actor.userId },
    });
    await tx.participant.update({ where: { id: p.id }, data: { invitedAt: new Date() } });
    await audit(tx, actor, { eventId: p.eventId, entity: "participant", entityId: p.id, action: "UPDATE", after: { invited: true } });
  });
  return { token, expiresAt, path: `/convite/${token}` };
}

/** Papéis que este usuário pode oferecer na tela "Montar equipe". */
export function rolesForForm(actor: Actor, eventId: string, areaId?: string | null) {
  requireEventAccess(actor, eventId);
  return assignableRoles(actor, eventId, areaId ?? membershipFor(actor, eventId)?.areaId);
}
