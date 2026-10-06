import { z } from "zod";
import type { Actor } from "../../server/authz/actor";
import { canReviewSla, canSeeTeam, canUsePreProduction } from "../../server/authz/policy";
import { audit, diff } from "../../server/audit/audit";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../server/errors";
import { isUniqueViolation } from "../../server/db/errors";
import type { Tx } from "../../server/db/with-user";
import { optionalText, parse, text, uuid } from "../../lib/validation";
import { requireEventAccess } from "../events/events.service";
import { getTeam } from "../teams/teams.service";

/**
 * Pré-produção: tipos de atendimento de cada equipe, o SLA de cada tipo
 * (proposto pelo Pré-produtor, revisto pelo Gerente com comentário) e a
 * planilha "quem faz o quê". Separada do campo: só o Pré-produtor e o Gerente
 * entram (canUsePreProduction). A RLS (migrations *_pre_producao_*) aplica o
 * mesmo perímetro no banco. O campo só lê os tipos ao abrir um chamado
 * (listServiceTypesForTickets).
 */

/** Fora da Pré-produção, ela simplesmente não existe (404, como recurso alheio). */
function requirePreProduction(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canUsePreProduction(actor, eventId)) throw new NotFoundError("Pré-produção");
}

const can = (actor: Actor, eventId: string) => ({
  manage: canUsePreProduction(actor, eventId),
  review: canReviewSla(actor, eventId),
});

/** Até 30 dias, em minutos. */
const minutes = z.coerce.number().int("Use minutos inteiros").min(1, "Mínimo 1 minuto").max(43200, "Máximo 30 dias");

type TypeScope = { eventId: string; areaId: string; teamId: string };

async function load(actor: Actor, tx: Tx, id: string) {
  const t = uuid.safeParse(id).success ? await tx.serviceType.findFirst({ where: { id, deletedAt: null } }) : null;
  if (!t || !canUsePreProduction(actor, t.eventId)) throw new NotFoundError("Tipo de atendimento");
  return t;
}

const listSchema = z.object({ teamId: uuid.optional() });

/** Tipos que a pessoa enxerga no evento, com SLA, proposta aguardando e quem faz. */
export async function listServiceTypes(actor: Actor, eventId: string, filters: unknown = {}) {
  requirePreProduction(actor, eventId);
  const f = parse(listSchema, filters);
  const rows = await actor.run((tx) =>
    tx.serviceType.findMany({
      where: { eventId, deletedAt: null, ...(f.teamId ? { teamId: f.teamId } : {}) },
      orderBy: [{ team: { area: { name: "asc" } } }, { team: { name: "asc" } }, { name: "asc" }],
      select: {
        id: true, eventId: true, areaId: true, teamId: true, name: true, description: true, slaMinutes: true,
        team: { select: { name: true, area: { select: { name: true } } } },
        people: { select: { participantId: true } },
        proposals: {
          where: { status: "PENDENTE" },
          select: { id: true, minutes: true, note: true, createdAt: true, proposedBy: { select: { name: true } } },
        },
      },
    }),
  );
  return rows.map(({ proposals, people, team, ...t }) => ({
    ...t,
    teamName: team.name,
    areaName: team.area.name,
    peopleIds: people.map((p) => p.participantId),
    pending: proposals[0] ?? null,
  }));
}

/** O que o campo vê dos tipos: nome e prazo, só das equipes que enxerga (formulário do chamado). */
export async function listServiceTypesForTickets(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  const rows = await actor.run((tx) =>
    tx.serviceType.findMany({
      where: { eventId, deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, eventId: true, areaId: true, teamId: true, name: true, slaMinutes: true },
    }),
  );
  return rows.filter((t) => canSeeTeam(actor, t));
}

/** Detalhe do tipo: histórico de SLA com comentários do gestor e quem faz. */
export async function getServiceType(actor: Actor, id: string) {
  return actor.run(async (tx) => {
    const base = await load(actor, tx, id);
    const t = await tx.serviceType.findUniqueOrThrow({
      where: { id: base.id },
      select: {
        id: true, eventId: true, areaId: true, teamId: true, name: true, description: true, slaMinutes: true,
        createdAt: true,
        team: { select: { name: true, area: { select: { name: true } } } },
        proposals: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true, minutes: true, note: true, status: true, approvedMinutes: true, feedback: true,
            createdAt: true, reviewedAt: true,
            proposedBy: { select: { id: true, name: true } },
            reviewedBy: { select: { id: true, name: true } },
          },
        },
        people: { select: { participant: { select: { id: true, name: true, jobTitle: true } } } },
      },
    });
    return { ...t, people: t.people.map((p) => p.participant), can: can(actor, base.eventId) };
  });
}

const createSchema = z.object({
  teamId: uuid,
  name: text(80),
  description: optionalText(1000),
  /** Do Gerente: vale na hora. Do Pré-produtor: vira proposta para o Gerente. */
  slaMinutes: minutes.optional().nullable(),
});

/** Evento e área vêm da equipe (lida no servidor), nunca do formulário. */
export async function createServiceType(actor: Actor, input: unknown) {
  const data = parse(createSchema, input);
  const team = await getTeam(actor, data.teamId);
  const scope: TypeScope = { eventId: team.eventId, areaId: team.areaId, teamId: team.id };
  requirePreProduction(actor, team.eventId);
  try {
    return await actor.run(async (tx) => {
      const t = await tx.serviceType.create({
        data: { ...scope, name: data.name, description: data.description, createdById: actor.userId },
      });
      await audit(tx, actor, { eventId: t.eventId, entity: "service_type", entityId: t.id, action: "CREATE", after: { name: t.name, teamId: t.teamId } });
      if (data.slaMinutes) {
        if (canReviewSla(actor, t.eventId)) await defineSla(tx, actor, t, data.slaMinutes, null);
        else await createProposal(tx, actor, t, data.slaMinutes, null);
      }
      return tx.serviceType.findUniqueOrThrow({ where: { id: t.id } });
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ValidationError(`Já existe o tipo "${data.name}" nesta equipe`);
    throw e;
  }
}

const updateSchema = z.object({
  name: text(80).optional(),
  description: optionalText(1000),
  archived: z.boolean().optional(),
});

/** Renomear, descrever ou arquivar (sai das listas; os chamados antigos mantêm o tipo). */
export async function updateServiceType(actor: Actor, id: string, input: unknown) {
  const data = parse(updateSchema, input);
  try {
    return await actor.run(async (tx) => {
      const t = await load(actor, tx, id);
      const patch = {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.archived && { deletedAt: new Date() }),
      };
      const updated = await tx.serviceType.update({ where: { id: t.id }, data: patch });
      const changes = diff(t as Record<string, unknown>, patch);
      await audit(tx, actor, {
        eventId: t.eventId, entity: "service_type", entityId: t.id, action: data.archived ? "DELETE" : "UPDATE", ...changes,
      });
      return updated;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ValidationError(`Já existe o tipo "${data.name}" nesta equipe`);
    throw e;
  }
}

/** Gestor define o SLA direto: fica no histórico como proposta já aprovada por ele. */
async function defineSla(tx: Tx, actor: Actor, t: TypeScope & { id: string }, value: number, note: string | null) {
  const now = new Date();
  const p = await tx.slaProposal.create({
    data: {
      eventId: t.eventId, areaId: t.areaId, teamId: t.teamId, serviceTypeId: t.id,
      minutes: value, note, status: "APROVADA", approvedMinutes: value,
      proposedById: actor.userId, reviewedById: actor.userId, reviewedAt: now,
    },
  });
  await tx.serviceType.update({ where: { id: t.id }, data: { slaMinutes: value } });
  await audit(tx, actor, {
    eventId: t.eventId, entity: "service_type", entityId: t.id, action: "UPDATE", after: { slaMinutes: value, proposalId: p.id },
  });
  return p;
}

const proposeSchema = z.object({ minutes, note: optionalText(500) });

async function createProposal(tx: Tx, actor: Actor, t: TypeScope & { id: string }, value: number, note: string | null) {
  const p = await tx.slaProposal.create({
    data: {
      eventId: t.eventId, areaId: t.areaId, teamId: t.teamId, serviceTypeId: t.id,
      minutes: value, note, proposedById: actor.userId,
    },
  });
  await audit(tx, actor, {
    eventId: t.eventId, entity: "sla_proposal", entityId: p.id, action: "CREATE",
    after: { serviceTypeId: t.id, minutes: p.minutes },
  });
  return p;
}

/**
 * Propor o SLA de um tipo. O Pré-produtor propõe e fica aguardando o Gerente;
 * o próprio Gerente define na hora.
 */
export async function proposeSla(actor: Actor, id: string, input: unknown) {
  const data = parse(proposeSchema, input);
  try {
    return await actor.run(async (tx) => {
      const t = await load(actor, tx, id);
      if (canReviewSla(actor, t.eventId)) return defineSla(tx, actor, t, data.minutes, data.note);
      return createProposal(tx, actor, t, data.minutes, data.note);
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError("Já existe uma proposta de SLA aguardando o gestor neste tipo");
    throw e;
  }
}

const reviewSchema = z
  .object({
    decision: z.enum(["APROVAR", "AJUSTAR", "RECUSAR"]),
    minutes: minutes.optional(),
    feedback: optionalText(1000),
  })
  .refine((v) => v.decision !== "AJUSTAR" || v.minutes, { message: "Informe o prazo ajustado", path: ["minutes"] })
  .refine((v) => v.decision === "APROVAR" || v.feedback, { message: "Explique o ajuste ou a recusa", path: ["feedback"] });

/** O gestor aprova, ajusta ou recusa a proposta, com comentário para quem propôs. */
export async function reviewSla(actor: Actor, proposalId: string, input: unknown) {
  const data = parse(reviewSchema, input);
  return actor.run(async (tx) => {
    const p = uuid.safeParse(proposalId).success ? await tx.slaProposal.findUnique({ where: { id: proposalId } }) : null;
    if (!p || !canUsePreProduction(actor, p.eventId)) throw new NotFoundError("Proposta de SLA");
    await load(actor, tx, p.serviceTypeId);
    if (!canReviewSla(actor, p.eventId)) throw new ForbiddenError("Só o gerente aprova, ajusta ou recusa o SLA");
    if (p.status !== "PENDENTE") throw new ConflictError("Esta proposta já foi revista");

    const status = data.decision === "APROVAR" ? "APROVADA" : data.decision === "AJUSTAR" ? "AJUSTADA" : "RECUSADA";
    const approvedMinutes = status === "APROVADA" ? p.minutes : status === "AJUSTADA" ? data.minutes! : null;
    const r = await tx.slaProposal.updateMany({
      where: { id: p.id, status: "PENDENTE" },
      data: { status, approvedMinutes, feedback: data.feedback, reviewedById: actor.userId, reviewedAt: new Date() },
    });
    if (r.count === 0) throw new ConflictError("Esta proposta já foi revista");
    if (approvedMinutes) await tx.serviceType.update({ where: { id: p.serviceTypeId }, data: { slaMinutes: approvedMinutes } });
    await audit(tx, actor, {
      eventId: p.eventId, entity: "sla_proposal", entityId: p.id, action: "VALIDATE",
      before: { status: p.status }, after: { status, approvedMinutes, feedback: data.feedback },
    });
    return tx.slaProposal.findUniqueOrThrow({ where: { id: p.id } });
  });
}

const personSchema = z.object({ participantId: uuid, does: z.boolean() });

/** Marca ou desmarca uma pessoa como alguém que faz este tipo de atendimento. */
export async function setServiceTypePerson(actor: Actor, id: string, input: unknown) {
  const data = parse(personSchema, input);
  return actor.run(async (tx) => {
    const t = await load(actor, tx, id);
    const person = await tx.participant.findFirst({
      where: { id: data.participantId, eventId: t.eventId, deletedAt: null },
      select: { id: true, areaId: true },
    });
    if (!person) throw new NotFoundError("Pessoa");
    if (person.areaId !== t.areaId) throw new ValidationError("Essa pessoa não é da área deste tipo de atendimento");

    const key = { serviceTypeId_participantId: { serviceTypeId: t.id, participantId: person.id } };
    const exists = await tx.serviceTypePerson.findUnique({ where: key });
    if (data.does && !exists) {
      await tx.serviceTypePerson.create({
        data: { eventId: t.eventId, areaId: t.areaId, teamId: t.teamId, serviceTypeId: t.id, participantId: person.id },
      });
    } else if (!data.does && exists) {
      await tx.serviceTypePerson.delete({ where: key });
    } else {
      return { does: data.does };
    }
    await audit(tx, actor, {
      eventId: t.eventId, entity: "service_type", entityId: t.id, action: "UPDATE",
      after: { [data.does ? "personAdded" : "personRemoved"]: person.id },
    });
    return { does: data.does };
  });
}

/** Tipo usado na abertura de um chamado: precisa ser da mesma equipe e estar ativo. */
export async function serviceTypeForOccurrence(tx: Tx, typeId: string, teamId: string) {
  const t = await tx.serviceType.findFirst({ where: { id: typeId, deletedAt: null } });
  if (!t || t.teamId !== teamId) throw new ValidationError("Tipo de atendimento não é desta equipe");
  return t;
}
