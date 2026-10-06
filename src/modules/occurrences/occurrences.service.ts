import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client";
import type { OccurrenceStatus } from "../../generated/prisma/enums";
import { membershipFor, type Actor } from "../../server/authz/actor";
import {
  canClaimOccurrence,
  canCreateOccurrence,
  canManageOccurrence,
  canSeeOccurrence,
  canValidateOccurrence,
  canWorkOccurrence,
} from "../../server/authz/policy";
import { audit } from "../../server/audit/audit";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../server/errors";
import type { Tx } from "../../server/db/with-user";
import { optionalText, parse, text, uuid } from "../../lib/validation";
import { requireEventAccess } from "../events/events.service";
import { getTeam } from "../teams/teams.service";
import { slaDueAt } from "./sla";

const STATUSES = ["PENDENTE", "EM_ANDAMENTO", "URGENTE", "BLOQUEIO", "CONCLUIDO", "CANCELADO"] as const;
const PRIORITIES = ["BAIXA", "NORMAL", "ALTA", "CRITICA"] as const;
const CLOSED: OccurrenceStatus[] = ["CONCLUIDO", "CANCELADO"];

/** Filtro de escopo no backend; a RLS do banco aplica o mesmo perímetro. */
export function occurrenceScope(actor: Actor, eventId: string): Prisma.OccurrenceWhereInput {
  if (actor.isAdmin) return { eventId };
  const m = membershipFor(actor, eventId);
  switch (m?.role) {
    case "GERENTE":
      return { eventId };
    case "HEAD":
      return { eventId, areaId: m.areaId! };
    case "OPERACIONAL":
      return { eventId, OR: [{ teamId: m.teamId! }, { responsibleParticipantId: m.participantId }] };
    default:
      // CLIENTE não vê ocorrências.
      return { id: { in: [] } };
  }
}

const listFields = {
  id: true, number: true, type: true, eventId: true, areaId: true, teamId: true,
  responsibleParticipantId: true, title: true, status: true, priority: true,
  openedAt: true, slaDueAt: true, concludedAt: true, durationSeconds: true, slaBreached: true,
  validationStatus: true, version: true,
  area: { select: { id: true, name: true } },
  team: { select: { id: true, name: true } },
  responsible: { select: { id: true, name: true } },
  _count: { select: { attachments: { where: { deletedAt: null } } } },
} satisfies Prisma.OccurrenceSelect;

const listSchema = z.object({
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  areaId: uuid.optional(),
  teamId: uuid.optional(),
  mine: z.coerce.boolean().optional(),
  open: z.coerce.boolean().optional(),
});

export async function listOccurrences(actor: Actor, eventId: string, filters: unknown = {}) {
  requireEventAccess(actor, eventId);
  const f = parse(listSchema, filters);
  const me = membershipFor(actor, eventId);
  return actor.run((tx) =>
    tx.occurrence.findMany({
      where: {
        AND: [
          occurrenceScope(actor, eventId),
          f.status ? { status: f.status } : {},
          f.priority ? { priority: f.priority } : {},
          f.areaId ? { areaId: f.areaId } : {},
          f.teamId ? { teamId: f.teamId } : {},
          f.open ? { status: { notIn: CLOSED } } : {},
          f.mine ? { responsibleParticipantId: me?.participantId ?? "00000000-0000-0000-0000-000000000000" } : {},
        ],
      },
      orderBy: [{ openedAt: "desc" }],
      select: listFields,
      take: 500,
    }),
  );
}

async function load(actor: Actor, tx: Tx, id: string) {
  const o = uuid.safeParse(id).success ? await tx.occurrence.findUnique({ where: { id } }) : null;
  if (!o || !canSeeOccurrence(actor, o)) throw new NotFoundError("Ocorrência");
  return o;
}

export async function getOccurrence(actor: Actor, id: string) {
  return actor.run(async (tx) => {
    const base = await load(actor, tx, id);
    const [detail, history] = await Promise.all([
      tx.occurrence.findUniqueOrThrow({
        where: { id: base.id },
        select: {
          ...listFields,
          process: true, description: true, clientId: true,
          concludedBy: { select: { id: true, name: true } },
          validatedBy: { select: { id: true, name: true } },
          validatedAt: true,
          createdBy: { select: { id: true, name: true } },
          attachments: {
            where: { deletedAt: null },
            orderBy: { createdAt: "asc" },
            select: { id: true, kind: true, mimeType: true, width: true, height: true, createdAt: true, uploadedById: true },
          },
        },
      }),
      tx.auditLog.findMany({
        where: { entity: "occurrence", entityId: base.id },
        orderBy: { occurredAt: "asc" },
        select: { id: true, occurredAt: true, actorUserId: true, action: true, before: true, after: true },
      }),
    ]);
    return {
      ...detail,
      history: history.map((h) => ({ ...h, id: h.id.toString() })),
      can: {
        work: canWorkOccurrence(actor, base),
        manage: canManageOccurrence(actor, base),
        validate: canValidateOccurrence(actor, base) && base.status === "CONCLUIDO",
        conclude: canWorkOccurrence(actor, base) && !CLOSED.includes(base.status),
        claim: canClaimOccurrence(actor, base),
      },
    };
  });
}

const createSchema = z.object({
  /** Gerado no celular: reenviar o mesmo chamado (offline) não duplica. */
  id: uuid.optional(),
  teamId: uuid,
  type: z.enum(["OCORRENCIA", "TAREFA"]).default("OCORRENCIA"),
  title: text(160),
  process: optionalText(160),
  description: optionalText(4000),
  priority: z.enum(PRIORITIES).default("NORMAL"),
  status: z.enum(["PENDENTE", "URGENTE", "BLOQUEIO"]).default("PENDENTE"),
  responsibleParticipantId: uuid.optional().nullable(),
});

/**
 * Abre uma ocorrência. Evento e área vêm da equipe (relida no servidor); cliente,
 * número, horário de abertura e prazo de SLA são definidos pelo servidor/banco.
 */
export async function createOccurrence(actor: Actor, input: unknown) {
  const data = parse(createSchema, input);
  const team = await getTeam(actor, data.teamId);
  const scope = { eventId: team.eventId, areaId: team.areaId, teamId: team.id };
  if (!canCreateOccurrence(actor, scope)) throw new ForbiddenError("Você não pode abrir ocorrências nesta equipe");

  return actor.run(async (tx) => {
    if (data.id) {
      const existing = await tx.occurrence.findUnique({ where: { id: data.id } });
      if (existing) {
        if (existing.createdById !== actor.userId) throw new ConflictError("ID já utilizado");
        return existing;
      }
    }

    if (data.responsibleParticipantId) {
      const r = await tx.participant.findFirst({
        where: { id: data.responsibleParticipantId, eventId: team.eventId, active: true, deletedAt: null },
      });
      if (!r) throw new ValidationError("Responsável não encontrado neste evento");
    }

    const openedAt = new Date();
    const policy = await tx.slaPolicy.findUnique({
      where: { eventId_priority: { eventId: team.eventId, priority: data.priority } },
    });
    const o = await tx.occurrence.create({
      data: {
        ...data,
        ...scope,
        clientId: membershipFor(actor, team.eventId)?.clientId ?? (await clientOf(tx, team.eventId)),
        openedAt,
        slaDueAt: slaDueAt(openedAt, policy?.targetMinutes),
        createdById: actor.userId,
      },
    });
    await audit(tx, actor, {
      eventId: o.eventId, entity: "occurrence", entityId: o.id, action: "CREATE",
      after: { title: o.title, status: o.status, priority: o.priority, teamId: o.teamId, responsibleParticipantId: o.responsibleParticipantId },
    });
    return o;
  });
}

async function clientOf(tx: Tx, eventId: string) {
  // Só para ADMIN (sem participação): o trigger do banco sobrescreve de qualquer forma.
  const e = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { clientId: true } });
  return e.clientId;
}

/** Atualização com controle de versão: se outra pessoa mudou antes, 409. */
async function updateVersioned(
  tx: Tx,
  id: string,
  expectedVersion: number | undefined,
  current: { version: number },
  data: Prisma.OccurrenceUncheckedUpdateManyInput,
) {
  const version = expectedVersion ?? current.version;
  const r = await tx.occurrence.updateMany({ where: { id, version }, data });
  if (r.count === 0) {
    throw new ConflictError(undefined, { currentVersion: current.version });
  }
  return tx.occurrence.findUniqueOrThrow({ where: { id } });
}

const statusSchema = z.object({
  status: z.enum(["PENDENTE", "EM_ANDAMENTO", "URGENTE", "BLOQUEIO", "CANCELADO"]),
  expectedVersion: z.number().int().positive().optional(),
});

export async function changeStatus(actor: Actor, id: string, input: unknown) {
  const data = parse(statusSchema, input);
  return actor.run(async (tx) => {
    const o = await load(actor, tx, id);
    if (CLOSED.includes(o.status)) throw new ValidationError("Ocorrência já encerrada");
    if (!canWorkOccurrence(actor, o, data.status)) throw new ForbiddenError();
    if (o.status === data.status) return o;
    const updated = await updateVersioned(tx, o.id, data.expectedVersion, o, { status: data.status });
    await audit(tx, actor, {
      eventId: o.eventId, entity: "occurrence", entityId: o.id,
      action: data.status === "CANCELADO" ? "CANCEL" : "STATUS_CHANGE",
      before: { status: o.status }, after: { status: data.status },
    });
    return updated;
  });
}

const concludeSchema = z.object({ expectedVersion: z.number().int().positive().optional() });

/**
 * CONCLUIR CHAMADO: status, horário, quem concluiu e histórico na mesma
 * transação. A duração e o estouro de SLA são calculados pelo banco.
 */
export async function concludeOccurrence(actor: Actor, id: string, input: unknown = {}) {
  const data = parse(concludeSchema, input);
  return actor.run(async (tx) => {
    const o = await load(actor, tx, id);
    if (o.status === "CONCLUIDO") throw new ValidationError("Ocorrência já concluída");
    if (o.status === "CANCELADO") throw new ValidationError("Ocorrência cancelada");
    if (!canWorkOccurrence(actor, o, "CONCLUIDO")) throw new ForbiddenError();
    const updated = await updateVersioned(tx, o.id, data.expectedVersion, o, {
      status: "CONCLUIDO",
      concludedAt: new Date(),
      concludedById: actor.userId,
      // Uma nova conclusão volta para a fila de validação do gestor.
      validationStatus: "PENDENTE",
      validatedAt: null,
      validatedById: null,
    });
    await audit(tx, actor, {
      eventId: o.eventId, entity: "occurrence", entityId: o.id, action: "CONCLUDE",
      before: { status: o.status },
      after: { status: "CONCLUIDO", durationSeconds: updated.durationSeconds, slaBreached: updated.slaBreached },
    });
    return updated;
  });
}

const validateSchema = z.object({
  approved: z.boolean(),
  expectedVersion: z.number().int().positive().optional(),
});

/** Validação do gestor. Reprovar reabre o chamado. */
export async function validateOccurrence(actor: Actor, id: string, input: unknown) {
  const data = parse(validateSchema, input);
  return actor.run(async (tx) => {
    const o = await load(actor, tx, id);
    if (!canValidateOccurrence(actor, o)) throw new ForbiddenError();
    if (o.status !== "CONCLUIDO") throw new ValidationError("Só ocorrências concluídas podem ser validadas");
    const updated = await updateVersioned(tx, o.id, data.expectedVersion, o, data.approved
      ? { validationStatus: "APROVADA", validatedAt: new Date(), validatedById: actor.userId }
      : {
          validationStatus: "REPROVADA", validatedAt: new Date(), validatedById: actor.userId,
          status: "EM_ANDAMENTO", concludedAt: null, concludedById: null,
        });
    await audit(tx, actor, {
      eventId: o.eventId, entity: "occurrence", entityId: o.id, action: "VALIDATE",
      before: { validationStatus: o.validationStatus, status: o.status },
      after: { validationStatus: updated.validationStatus, status: updated.status },
    });
    return updated;
  });
}

/** "Assumir": o Operacional vira o responsável por um chamado livre da equipe. */
export async function claimOccurrence(actor: Actor, id: string, input: unknown = {}) {
  const data = parse(concludeSchema, input);
  return actor.run(async (tx) => {
    const o = await load(actor, tx, id);
    if (!canClaimOccurrence(actor, o)) throw new ForbiddenError("Este chamado já tem responsável ou não é da sua equipe");
    const me = membershipFor(actor, o.eventId)!;
    const updated = await updateVersioned(tx, o.id, data.expectedVersion, o, {
      responsibleParticipantId: me.participantId,
      ...(o.status === "PENDENTE" && { status: "EM_ANDAMENTO" }),
    });
    await audit(tx, actor, {
      eventId: o.eventId, entity: "occurrence", entityId: o.id, action: "REASSIGN",
      before: { responsibleParticipantId: null, status: o.status },
      after: { responsibleParticipantId: me.participantId, status: updated.status },
    });
    return updated;
  });
}

const reassignSchema = z.object({
  responsibleParticipantId: uuid.nullable().optional(),
  teamId: uuid.optional(),
  priority: z.enum(PRIORITIES).optional(),
  expectedVersion: z.number().int().positive().optional(),
});

/** Reatribuir responsável, mover de equipe ou mudar prioridade (Gerente/Head). */
export async function reassignOccurrence(actor: Actor, id: string, input: unknown) {
  const data = parse(reassignSchema, input);
  const current = await actor.run((tx) => load(actor, tx, id));
  if (!canManageOccurrence(actor, current)) throw new ForbiddenError();
  if (CLOSED.includes(current.status)) throw new ValidationError("Ocorrência já encerrada");

  let target = { areaId: current.areaId, teamId: current.teamId };
  if (data.teamId && data.teamId !== current.teamId) {
    const team = await getTeam(actor, data.teamId);
    if (team.eventId !== current.eventId) throw new NotFoundError("Equipe");
    if (!canManageOccurrence(actor, { eventId: team.eventId, areaId: team.areaId })) throw new ForbiddenError();
    target = { areaId: team.areaId, teamId: team.id };
  }

  return actor.run(async (tx) => {
    if (data.responsibleParticipantId) {
      const r = await tx.participant.findFirst({
        where: { id: data.responsibleParticipantId, eventId: current.eventId, active: true, deletedAt: null },
      });
      if (!r) throw new ValidationError("Responsável não encontrado neste evento");
    }
    const patch = {
      ...target,
      ...(data.responsibleParticipantId !== undefined && { responsibleParticipantId: data.responsibleParticipantId }),
      ...(data.priority && { priority: data.priority }),
    };
    const updated = await updateVersioned(tx, current.id, data.expectedVersion, current, patch);
    const action = target.teamId !== current.teamId ? "TEAM_CHANGE" : "REASSIGN";
    await audit(tx, actor, {
      eventId: current.eventId, entity: "occurrence", entityId: current.id, action,
      before: { teamId: current.teamId, responsibleParticipantId: current.responsibleParticipantId, priority: current.priority },
      after: { teamId: updated.teamId, responsibleParticipantId: updated.responsibleParticipantId, priority: updated.priority },
    });
    return updated;
  });
}
