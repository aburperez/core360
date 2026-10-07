import { z } from "zod";
import type { Actor } from "../../server/authz/actor";
import { isAgencyAdmin } from "../../server/authz/actor";
import { audit, diff } from "../../server/audit/audit";
import { ConflictError, NotFoundError, ValidationError } from "../../server/errors";
import { isUniqueViolation } from "../../server/db/errors";
import { hashToken, newToken } from "../../lib/tokens";
import { parse, text, uuid } from "../../lib/validation";
import { INVITE_TTL_DAYS } from "../participants/participants.service";

/**
 * Agências que alugam o CORE 360. O Admin da plataforma cria a agência e o
 * primeiro Admin dela, suspende e reativa. O Admin da agência cadastra outros
 * Admins da própria agência. A RLS (migration 20261007120000_agencias) garante
 * que ninguém veja agência alheia.
 */

function requirePlatform(actor: Actor) {
  if (!actor.isPlatformAdmin) throw new NotFoundError("Página");
}

/** Plataforma, ou Admin desta agência. */
function requireAgencyManager(actor: Actor, agencyId: string) {
  if (!uuid.safeParse(agencyId).success || !(actor.isPlatformAdmin || isAgencyAdmin(actor, agencyId))) {
    throw new NotFoundError("Agência");
  }
}

const email = z.email({ message: "E-mail inválido" }).trim().toLowerCase();

const adminSelect = { id: true, name: true, email: true, active: true, userId: true, createdAt: true } as const;

function adminView(a: { id: string; name: string; email: string; active: boolean; userId: string | null; createdAt: Date }) {
  const { userId, ...rest } = a;
  return { ...rest, linked: !!userId };
}

export async function listAgencies(actor: Actor) {
  requirePlatform(actor);
  const rows = await actor.run((tx) =>
    tx.agency.findMany({
      orderBy: [{ status: "asc" }, { name: "asc" }],
      select: { id: true, name: true, status: true, createdAt: true, admins: { select: adminSelect, orderBy: { name: "asc" } } },
    }),
  );
  return rows.map((g) => ({ ...g, admins: g.admins.map(adminView) }));
}

/** Uma agência com os Admins dela (para a plataforma ou para o próprio Admin). */
export async function getAgency(actor: Actor, agencyId: string) {
  requireAgencyManager(actor, agencyId);
  const g = await actor.run((tx) =>
    tx.agency.findUnique({
      where: { id: agencyId },
      select: { id: true, name: true, status: true, createdAt: true, admins: { select: adminSelect, orderBy: { name: "asc" } } },
    }),
  );
  if (!g) throw new NotFoundError("Agência");
  return { ...g, admins: g.admins.map(adminView) };
}

const createSchema = z.object({
  name: text(120),
  adminName: text(120),
  adminEmail: email,
});

/** Nova agência já com o primeiro Admin e o link de convite dele. */
export async function createAgency(actor: Actor, input: unknown) {
  requirePlatform(actor);
  const data = parse(createSchema, input);
  const token = newToken();
  const expiresAt = inviteExpiry();
  const agency = await actor.run(async (tx) => {
    const g = await tx.agency.create({ data: { name: data.name }, select: { id: true, name: true } });
    const a = await tx.agencyAdmin.create({ data: { agencyId: g.id, name: data.adminName, email: data.adminEmail }, select: { id: true } });
    await tx.agencyInvitation.create({
      data: { agencyId: g.id, agencyAdminId: a.id, tokenHash: hashToken(token), expiresAt, createdById: actor.userId },
    });
    await audit(tx, actor, { entity: "agency", entityId: g.id, action: "CREATE", after: { name: data.name, admin: data.adminEmail } });
    return g;
  });
  return { ...agency, invite: { token, expiresAt, path: `/convite/${token}` } };
}

const updateSchema = z.object({
  name: text(120).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
});

/** Renomear, suspender (ninguém da agência entra) ou reativar. Só a plataforma. */
export async function updateAgency(actor: Actor, agencyId: string, input: unknown) {
  requirePlatform(actor);
  if (!uuid.safeParse(agencyId).success) throw new NotFoundError("Agência");
  const data = parse(updateSchema, input);
  return actor.run(async (tx) => {
    const before = await tx.agency.findUnique({ where: { id: agencyId }, select: { name: true, status: true } });
    if (!before) throw new NotFoundError("Agência");
    const changes = diff(before, data);
    if (!Object.keys(changes.after).length) return { id: agencyId };
    await tx.agency.update({ where: { id: agencyId }, data });
    const action = "status" in changes.after ? (data.status === "ACTIVE" ? "ACTIVATE" : "DEACTIVATE") : "UPDATE";
    await audit(tx, actor, { entity: "agency", entityId: agencyId, action, ...changes });
    return { id: agencyId };
  });
}

const adminSchema = z.object({ name: text(120), email });

/** Mais um Admin na agência (a plataforma ou um Admin dela). */
export async function addAgencyAdmin(actor: Actor, agencyId: string, input: unknown) {
  requireAgencyManager(actor, agencyId);
  const data = parse(adminSchema, input);
  try {
    return await actor.run(async (tx) => {
      const a = await tx.agencyAdmin.create({ data: { agencyId, ...data }, select: adminSelect });
      await audit(tx, actor, { entity: "agency_admin", entityId: a.id, action: "CREATE", after: { agencyId, ...data } });
      return adminView(a);
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError("Esta pessoa já é Admin desta agência");
    throw e;
  }
}

const adminUpdateSchema = z.object({ name: text(120).optional(), active: z.boolean().optional() });

export async function updateAgencyAdmin(actor: Actor, adminId: string, input: unknown) {
  if (!uuid.safeParse(adminId).success) throw new NotFoundError("Admin");
  const data = parse(adminUpdateSchema, input);
  return actor.run(async (tx) => {
    const before = await tx.agencyAdmin.findUnique({ where: { id: adminId }, select: { agencyId: true, name: true, active: true, userId: true } });
    if (!before) throw new NotFoundError("Admin");
    requireAgencyManager(actor, before.agencyId);
    if (data.active === false && before.userId === actor.userId) throw new ValidationError("Você não pode tirar o seu próprio acesso de Admin");
    const changes = diff({ name: before.name, active: before.active }, data);
    if (!Object.keys(changes.after).length) return { id: adminId };
    await tx.agencyAdmin.update({ where: { id: adminId }, data });
    const action = "active" in changes.after ? (data.active ? "ACTIVATE" : "DEACTIVATE") : "UPDATE";
    await audit(tx, actor, { entity: "agency_admin", entityId: adminId, action, ...changes });
    return { id: adminId };
  });
}

/** Link de convite (mostrado uma vez) para o Admin entrar e criar a senha. */
export async function createAgencyAdminInvitation(actor: Actor, adminId: string) {
  if (!uuid.safeParse(adminId).success) throw new NotFoundError("Admin");
  const token = newToken();
  const expiresAt = inviteExpiry();
  await actor.run(async (tx) => {
    const a = await tx.agencyAdmin.findUnique({ where: { id: adminId }, select: { agencyId: true, active: true, userId: true } });
    if (!a) throw new NotFoundError("Admin");
    requireAgencyManager(actor, a.agencyId);
    if (!a.active) throw new ValidationError("Admin desativado");
    if (a.userId) throw new ValidationError("Esta pessoa já entrou no app. Ela usa a senha de sempre.");
    await tx.agencyInvitation.create({
      data: { agencyId: a.agencyId, agencyAdminId: adminId, tokenHash: hashToken(token), expiresAt, createdById: actor.userId },
    });
    await audit(tx, actor, { entity: "agency_admin", entityId: adminId, action: "UPDATE", after: { invited: true } });
  });
  return { token, expiresAt, path: `/convite/${token}` };
}

function inviteExpiry() {
  return new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600_000);
}
