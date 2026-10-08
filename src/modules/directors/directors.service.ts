import { z } from "zod";
import type { Actor } from "../../server/authz/actor";
import { isAgencyAdmin, isAgencyFullAdmin } from "../../server/authz/actor";
import { audit, diff } from "../../server/audit/audit";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../server/errors";
import { isUniqueViolation } from "../../server/db/errors";
import { optionalText, parse, text, uuid } from "../../lib/validation";
import { resolveAgency } from "../clients/clients.service";
import { createAgencyAdminInvitation } from "../agencies/agencies.service";

/**
 * Diretores de produção: são o painel administrativo da agência. Cada um tem
 * login próprio, abre clientes e eventos e entra como Gerente em todos os
 * eventos abertos da agência, inclusive os criados depois (gatilhos das
 * migrations 20261006120000_diretores, 20261007120000_agencias e
 * 20261008200000_diretor_admin, que liga cada diretor ao acesso de Admin).
 * Um convite só liga a conta na agência e em todos os eventos.
 * O Suporte CORE 360 vê a lista, mas só um diretor cadastra ou muda diretores.
 */

function requireAdmin(actor: Actor) {
  if (!isAgencyAdmin(actor)) throw new NotFoundError("Página");
}

function requireManager(actor: Actor, agencyId: string) {
  if (!isAgencyFullAdmin(actor, agencyId)) throw new ForbiddenError("Só um diretor de produção da agência cadastra ou muda diretores");
}

const OPEN_EVENT = { deletedAt: null, status: { notIn: ["CONCLUIDO" as const, "CANCELADO" as const] } };

const select = {
  id: true, name: true, email: true, phone: true, jobTitle: true, active: true, userId: true, createdAt: true,
  agencyAdmin: { select: { _count: { select: { invitations: true } } } },
  participants: {
    where: { deletedAt: null, event: OPEN_EVENT },
    select: { active: true, invitedAt: true, event: { select: { id: true, name: true } } },
    orderBy: { event: { startsAt: "asc" as const } },
  },
} as const;

type Row = {
  id: string; name: string; email: string; phone: string | null; jobTitle: string | null; active: boolean;
  userId: string | null; createdAt: Date;
  agencyAdmin: { _count: { invitations: number } } | null;
  participants: { active: boolean; invitedAt: Date | null; event: { id: string; name: string } }[];
};

function view(d: Row, me?: string) {
  const { userId, participants, agencyAdmin, ...rest } = d;
  return {
    ...rest,
    me: !!userId && userId === me,
    linked: !!userId,
    invited: !!agencyAdmin?._count.invitations || participants.some((p) => p.invitedAt),
    events: participants.filter((p) => p.active).map((p) => p.event),
  };
}

export async function listDirectors(actor: Actor, agencyId?: string | null) {
  requireAdmin(actor);
  const agency = resolveAgency(actor, agencyId);
  const rows = await actor.run((tx) =>
    tx.director.findMany({ where: { agencyId: agency.id }, orderBy: [{ active: "desc" }, { name: "asc" }], select }),
  );
  return rows.map((d) => view(d, actor.userId));
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
  requireManager(actor, agency.id);
  try {
    return await actor.run(async (tx) => {
      const d = await tx.director.create({ data: { ...data, agencyId: agency.id, createdById: actor.userId }, select });
      await audit(tx, actor, { entity: "director", entityId: d.id, action: "CREATE", after: { ...data, agencyId: agency.id, events: d.participants.length } });
      return view(d);
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError("Esta pessoa já está na agência (como diretor ou Suporte)");
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
    const found = await tx.director.findUnique({
      where: { id: directorId },
      select: { agencyId: true, userId: true, name: true, phone: true, jobTitle: true, active: true },
    });
    if (!found) throw new NotFoundError("Diretor");
    const { agencyId, userId, ...before } = found;
    requireManager(actor, agencyId);
    if (data.active === false && userId === actor.userId) throw new ValidationError("Você não pode desativar o seu próprio acesso");
    const changes = diff(before, data);
    const d = await tx.director.update({ where: { id: directorId }, data, select });
    if (Object.keys(changes.after).length) {
      const action = "active" in changes.after ? (data.active ? "ACTIVATE" : "DEACTIVATE") : "UPDATE";
      await audit(tx, actor, { entity: "director", entityId: d.id, action, ...changes });
    }
    return view(d, actor.userId);
  });
}

/**
 * Convite do diretor: um link só, de acesso à agência (vale mesmo sem evento
 * aberto). Ao aceitar, o banco liga a conta na agência e em todos os eventos.
 */
export async function createDirectorInvitation(actor: Actor, directorId: string) {
  requireAdmin(actor);
  if (!uuid.safeParse(directorId).success) throw new NotFoundError("Diretor");
  const d = await actor.run((tx) =>
    tx.director.findUnique({ where: { id: directorId }, select: { agencyId: true, active: true, userId: true, agencyAdmin: { select: { id: true } } } }),
  );
  if (!d) throw new NotFoundError("Diretor");
  requireManager(actor, d.agencyId);
  if (!d.active) throw new ValidationError("Diretor desativado");
  if (d.userId) throw new ValidationError("Este diretor já entrou no app. Ele usa a senha de sempre.");
  if (!d.agencyAdmin) throw new NotFoundError("Diretor");
  return createAgencyAdminInvitation(actor, d.agencyAdmin.id);
}
