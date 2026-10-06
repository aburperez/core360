import { z } from "zod";
import type { Actor } from "../../server/authz/actor";
import type { Tx } from "../../server/db/with-user";
import { canUseField, canUsePreProduction } from "../../server/authz/policy";
import { membershipFor } from "../../server/authz/actor";
import { audit } from "../../server/audit/audit";
import { NotFoundError, ValidationError } from "../../server/errors";
import { optionalText, parse, uuid } from "../../lib/validation";
import { requireEventAccess } from "../events/events.service";

/**
 * Briefing por pessoa: a Pré-produção (Gerente ou Pré-produtor) escreve o que
 * cada pessoa do campo faz, onde e quando. A pessoa lê o seu em "Meu briefing"
 * e confirma. Tipos de atendimento e contatos entram sozinhos, a partir do
 * "quem faz o quê" e da equipe. O banco guarda a versão: mudou o texto depois
 * de lido, a leitura vale de novo.
 */

/** Quem recebe briefing: gente do campo. */
const FIELD_ROLES = ["GERENTE", "HEAD", "OPERACIONAL"] as const;

export type BriefingState = "SEM" | "NAO_LIDO" | "LIDO" | "MUDOU";

export function briefingState(b: { version: number; readVersion: number } | null): BriefingState {
  if (!b) return "SEM";
  if (b.readVersion === 0) return "NAO_LIDO";
  return b.readVersion === b.version ? "LIDO" : "MUDOU";
}

const briefingSchema = z
  .object({
    roleText: optionalText(120),
    post: optionalText(500),
    schedule: optionalText(2000),
    duties: optionalText(4000),
    notes: optionalText(2000),
  })
  .refine((b) => b.roleText || b.post || b.schedule || b.duties || b.notes, {
    message: "Preencha pelo menos um campo",
    path: ["duties"],
  });

type BriefingText = z.output<typeof briefingSchema>;

function requirePre(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canUsePreProduction(actor, eventId)) throw new NotFoundError("Pré-produção");
}

const personSelect = {
  id: true, name: true, role: true, jobTitle: true, phone: true, areaId: true, teamId: true,
  area: { select: { id: true, name: true } },
  team: { select: { id: true, name: true, leaderParticipantId: true } },
} as const;

const briefingSelect = {
  id: true, roleText: true, post: true, schedule: true, duties: true, notes: true,
  version: true, readVersion: true, readAt: true, updatedAt: true,
  updatedBy: { select: { name: true } },
} as const;

type WithUpdatedBy = { updatedBy: { name: string } | null };

/** Quem escreveu. No campo a pessoa pode não enxergar esse usuário (RLS): fica vazio. */
function withAuthor<T extends WithUpdatedBy>(b: T) {
  return { ...b, updatedBy: (b.updatedBy as { name: string } | null)?.name ?? null };
}

/** Pré-produção › Briefing: todas as pessoas do campo e a situação do briefing de cada uma. */
export async function listBriefings(actor: Actor, eventId: string) {
  requirePre(actor, eventId);
  const people = await actor.run((tx) =>
    tx.participant.findMany({
      where: { eventId, active: true, deletedAt: null, role: { in: [...FIELD_ROLES] } },
      orderBy: [{ area: { name: "asc" } }, { team: { name: "asc" } }, { name: "asc" }],
      select: { ...personSelect, briefing: { select: briefingSelect } },
    }),
  );
  return people.map(({ briefing, ...p }) => ({
    ...p,
    briefing: briefing ? withAuthor(briefing) : null,
    state: briefingState(briefing),
  }));
}

/** O que entra sozinho no briefing: tipos que a pessoa faz e com quem falar. */
async function autoContent(tx: Tx, eventId: string, person: { id: string; areaId: string | null; team: { leaderParticipantId: string | null } | null }) {
  const types = await tx.serviceTypePerson.findMany({
    where: { eventId, participantId: person.id, serviceType: { deletedAt: null } },
    select: { serviceType: { select: { id: true, name: true, slaMinutes: true } } },
    orderBy: { serviceType: { name: "asc" } },
  });
  const contacts = await tx.participant.findMany({
    where: {
      eventId, active: true, deletedAt: null, id: { not: person.id },
      OR: [
        { role: "GERENTE" },
        ...(person.areaId ? [{ role: "HEAD" as const, areaId: person.areaId }] : []),
        ...(person.team?.leaderParticipantId ? [{ id: person.team.leaderParticipantId }] : []),
      ],
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
    select: { id: true, name: true, role: true, jobTitle: true, phone: true },
  });
  const leader = person.team?.leaderParticipantId ?? null;
  return {
    types: types.map((t) => t.serviceType),
    contacts: contacts.map((c) => ({ ...c, isLeader: c.id === leader })),
  };
}

/** Um briefing para editar, com o que entra sozinho. */
export async function getBriefingFor(actor: Actor, eventId: string, participantId: string) {
  requirePre(actor, eventId);
  if (!uuid.safeParse(participantId).success) throw new NotFoundError("Pessoa");
  return actor.run(async (tx) => {
    const person = await tx.participant.findFirst({
      where: { id: participantId, eventId, active: true, deletedAt: null, role: { in: [...FIELD_ROLES] } },
      select: { ...personSelect, briefing: { select: briefingSelect } },
    });
    if (!person) throw new NotFoundError("Pessoa");
    const { briefing, ...p } = person;
    return {
      person: p,
      briefing: briefing ? withAuthor(briefing) : null,
      state: briefingState(briefing),
      auto: await autoContent(tx, eventId, person),
    };
  });
}

async function upsert(tx: Tx, actor: Actor, eventId: string, participantId: string, data: BriefingText) {
  const before = await tx.briefing.findUnique({ where: { participantId } });
  const saved = before
    ? // O autor e a versão o banco acerta sozinho quando o texto muda.
      await tx.briefing.update({ where: { id: before.id }, data })
    : await tx.briefing.create({ data: { ...data, eventId, participantId, updatedById: actor.userId } });
  if (!before || saved.version !== before.version) {
    await audit(tx, actor, {
      eventId, entity: "briefing", entityId: saved.id, action: before ? "UPDATE" : "CREATE",
      before: before ? { version: before.version } : null,
      after: { participantId, version: saved.version },
    });
  }
  return saved;
}

/** Escreve (ou reescreve) o briefing de uma pessoa do campo. */
export async function saveBriefing(actor: Actor, eventId: string, participantId: string, input: unknown) {
  requirePre(actor, eventId);
  const data = parse(briefingSchema, input);
  if (!uuid.safeParse(participantId).success) throw new NotFoundError("Pessoa");
  return actor.run(async (tx) => {
    const person = await tx.participant.findFirst({
      where: { id: participantId, eventId, active: true, deletedAt: null },
      select: { id: true, role: true },
    });
    if (!person) throw new NotFoundError("Pessoa");
    if (!(FIELD_ROLES as readonly string[]).includes(person.role)) {
      throw new ValidationError("Briefing é para quem está no campo (Gerente, Head ou Operacional)");
    }
    const saved = await upsert(tx, actor, eventId, participantId, data);
    return { id: saved.id, version: saved.version, state: briefingState(saved) };
  });
}

/** Escreve uma vez e aplica a todos da equipe (substitui o que já havia). */
export async function applyBriefingToTeam(actor: Actor, teamId: string, input: unknown) {
  const data = parse(briefingSchema, input);
  const team = uuid.safeParse(teamId).success
    ? await actor.run((tx) => tx.team.findFirst({ where: { id: teamId, deletedAt: null }, select: { id: true, eventId: true, name: true } }))
    : null;
  if (!team || !canUsePreProduction(actor, team.eventId)) throw new NotFoundError("Equipe");
  return actor.run(async (tx) => {
    const people = await tx.participant.findMany({
      where: { eventId: team.eventId, teamId: team.id, active: true, deletedAt: null, role: { in: [...FIELD_ROLES] } },
      select: { id: true },
    });
    if (people.length === 0) throw new ValidationError("Esta equipe não tem ninguém do campo ainda");
    for (const p of people) await upsert(tx, actor, team.eventId, p.id, data);
    return { count: people.length };
  });
}

export async function deleteBriefing(actor: Actor, briefingId: string) {
  const b = uuid.safeParse(briefingId).success ? await actor.run((tx) => tx.briefing.findUnique({ where: { id: briefingId } })) : null;
  if (!b || !canUsePreProduction(actor, b.eventId)) throw new NotFoundError("Briefing");
  return actor.run(async (tx) => {
    await tx.briefing.delete({ where: { id: b.id } });
    await audit(tx, actor, { eventId: b.eventId, entity: "briefing", entityId: b.id, action: "DELETE", before: { participantId: b.participantId, version: b.version } });
    return { ok: true };
  });
}

// ───────────────────────────── No campo ─────────────────────────────

function myParticipant(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canUseField(actor, eventId)) throw new NotFoundError("Briefing");
  return membershipFor(actor, eventId)?.participantId ?? null;
}

/** "Meu briefing": só o da própria pessoa, com tipos e contatos. */
export async function getMyBriefing(actor: Actor, eventId: string) {
  const me = myParticipant(actor, eventId);
  if (!me) return null;
  return actor.run(async (tx) => {
    const person = await tx.participant.findFirst({
      where: { id: me, eventId },
      select: { ...personSelect, briefing: { select: briefingSelect } },
    });
    if (!person?.briefing) return null;
    const { briefing, ...p } = person;
    return {
      person: p,
      briefing: withAuthor(briefing),
      state: briefingState(briefing),
      auto: await autoContent(tx, eventId, person),
    };
  });
}

/** Situação do meu briefing (para o cartão da tela inicial e o menu). */
export async function myBriefingState(actor: Actor, eventId: string): Promise<BriefingState> {
  if (!canUseField(actor, eventId)) return "SEM";
  const me = membershipFor(actor, eventId)?.participantId;
  if (!me) return "SEM";
  const b = await actor.run((tx) => tx.briefing.findUnique({ where: { participantId: me }, select: { version: true, readVersion: true } }));
  return briefingState(b);
}

/** "Li e entendi": confirma a leitura da versão atual. */
export async function markBriefingRead(actor: Actor, eventId: string) {
  const me = myParticipant(actor, eventId);
  if (!me) throw new NotFoundError("Briefing");
  return actor.run(async (tx) => {
    const b = await tx.briefing.findUnique({ where: { participantId: me } });
    if (!b) throw new NotFoundError("Briefing");
    if (b.readVersion !== b.version) {
      await tx.briefing.update({ where: { id: b.id }, data: { readVersion: b.version, readAt: new Date() } });
      await audit(tx, actor, { eventId, entity: "briefing", entityId: b.id, action: "UPDATE", after: { readVersion: b.version } });
    }
    return { state: "LIDO" as const };
  });
}
