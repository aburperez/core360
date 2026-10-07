import { z } from "zod";
import type { Actor } from "../../server/authz/actor";
import { isAgencyAdmin } from "../../server/authz/actor";
import { audit, diff } from "../../server/audit/audit";
import { ConflictError, NotFoundError, ValidationError } from "../../server/errors";
import { isUniqueViolation } from "../../server/db/errors";
import { optionalText, parse, text, uuid } from "../../lib/validation";
import { createInvitation } from "../participants/participants.service";
import { resolveAgency } from "../clients/clients.service";

/**
 * Diretores de produção: o Admin da agência cadastra uma vez e o banco põe a
 * pessoa como Gerente em todos os eventos abertos DA AGÊNCIA, inclusive os
 * criados depois (gatilhos das migrations 20261006120000_diretores e
 * 20261007120000_agencias). Um convite só liga a conta em todos os eventos.
 * Só o Admin da agência vê esta parte; para os outros ela não existe.
 */

function requireAdmin(actor: Actor) {
  if (!isAgencyAdmin(actor)) throw new NotFoundError("Página");
}

const OPEN_EVENT = { deletedAt: null, status: { notIn: ["FINALIZADO" as const, "CANCELADO" as const] } };

const select = {
  id: true, name: true, email: true, phone: true, jobTitle: true, active: true, userId: true, createdAt: true,
  participants: {
    where: { deletedAt: null, event: OPEN_EVENT },
    select: { active: true, invitedAt: true, event: { select: { id: true, name: true } } },
    orderBy: { event: { startsAt: "asc" as const } },
  },
} as const;

type Row = {
  id: string; name: string; email: string; phone: string | null; jobTitle: string | null; active: boolean;
  userId: string | null; createdAt: Date;
  participants: { active: boolean; invitedAt: Date | null; event: { id: string; name: string } }[];
};

function view(d: Row) {
  const { userId, participants, ...rest } = d;
  return {
    ...rest,
    linked: !!userId,
    invited: participants.some((p) => p.invitedAt),
    events: participants.filter((p) => p.active).map((p) => p.event),
  };
}

export async function listDirectors(actor: Actor, agencyId?: string | null) {
  requireAdmin(actor);
  const agency = resolveAgency(actor, agencyId);
  const rows = await actor.run((tx) =>
    tx.director.findMany({ where: { agencyId: agency.id }, orderBy: [{ active: "desc" }, { name: "asc" }], select }),
  );
  return rows.map(view);
}

const createSchema = z.object({
  agencyId: uuid.optional(),
  name: text(120),
  email: z.email({ message: "E-mail inválido" }).trim().toLowerCase(),
  phone: optionalText(30),
  jobTitle: optionalText(80),
});

/** Cadastra o diretor. O banco já o coloca como Gerente nos eventos abertos. */
export async function createDirector(actor: Actor, input: unknown) {
  requireAdmin(actor);
  const { agencyId, ...data } = parse(createSchema, input);
  const agency = resolveAgency(actor, agencyId);
  try {
    return await actor.run(async (tx) => {
      const d = await tx.director.create({ data: { ...data, agencyId: agency.id, createdById: actor.userId }, select });
      await audit(tx, actor, { entity: "director", entityId: d.id, action: "CREATE", after: { ...data, agencyId: agency.id, events: d.participants.length } });
      return view(d);
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError("Já existe um diretor com este e-mail");
    throw e;
  }
}

const updateSchema = z.object({
  name: text(120).optional(),
  phone: optionalText(30),
  jobTitle: optionalText(80),
  active: z.boolean().optional(),
});

/** Muda nome, telefone, cargo ou desativa. Vale para todos os eventos dele. */
export async function updateDirector(actor: Actor, directorId: string, input: unknown) {
  requireAdmin(actor);
  if (!uuid.safeParse(directorId).success) throw new NotFoundError("Diretor");
  const data = parse(updateSchema, input);
  return actor.run(async (tx) => {
    const before = await tx.director.findUnique({ where: { id: directorId }, select: { name: true, phone: true, jobTitle: true, active: true } });
    if (!before) throw new NotFoundError("Diretor");
    const changes = diff(before, data);
    const d = await tx.director.update({ where: { id: directorId }, data, select });
    if (Object.keys(changes.after).length) {
      const action = "active" in changes.after ? (data.active ? "ACTIVATE" : "DEACTIVATE") : "UPDATE";
      await audit(tx, actor, { entity: "director", entityId: d.id, action, ...changes });
    }
    return view(d);
  });
}

/**
 * Convite do diretor: um link só. Ele é gerado para uma das participações
 * dele; ao aceitar, o banco liga a conta em todos os eventos.
 */
export async function createDirectorInvitation(actor: Actor, directorId: string) {
  requireAdmin(actor);
  if (!uuid.safeParse(directorId).success) throw new NotFoundError("Diretor");
  const d = await actor.run((tx) =>
    tx.director.findUnique({
      where: { id: directorId },
      select: {
        active: true, userId: true,
        participants: {
          where: { active: true, deletedAt: null, userId: null, event: OPEN_EVENT },
          select: { id: true },
          orderBy: { event: { startsAt: "asc" } },
          take: 1,
        },
      },
    }),
  );
  if (!d) throw new NotFoundError("Diretor");
  if (!d.active) throw new ValidationError("Diretor desativado");
  if (d.userId) throw new ValidationError("Este diretor já entrou no app. Ele usa a senha de sempre em todos os eventos.");
  if (!d.participants[0]) throw new ValidationError("Ainda não há evento aberto. O convite fica disponível quando houver um evento.");
  return createInvitation(actor, d.participants[0].id);
}
