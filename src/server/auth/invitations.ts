import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client";
import { isIP } from "node:net";
import { hashToken } from "../../lib/tokens";
import { normalizePhone } from "../../lib/phone";
import { parse } from "../../lib/validation";
import { ValidationError } from "../errors";
import { MIN_PASSWORD_LENGTH } from "./auth";

const acceptSchema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(MIN_PASSWORD_LENGTH, `A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres`).max(128),
  /** Aceite para receber avisos no WhatsApp (opcional). */
  whatsapp: z.object({ phone: z.string().max(30), enabled: z.boolean() }).optional(),
});

const INVALID = "Convite inválido ou expirado";

/** Dados mostrados na tela do convite antes de definir a senha. */
export async function previewInvitation(db: PrismaClient, token: string) {
  const tokenHash = hashToken(token);
  const inv = await db.invitation.findUnique({
    where: { tokenHash },
    include: { participant: { select: { name: true, email: true, phone: true, active: true, deletedAt: true } } },
  });
  let person: { name: string; email: string; phone: string | null; agency?: string } | null = null;
  if (inv) {
    if (!inv.usedAt && inv.expiresAt >= new Date() && inv.participant.active && !inv.participant.deletedAt) person = inv.participant;
  } else {
    // Convite para Admin de uma agência.
    const ai = await db.agencyInvitation.findUnique({
      where: { tokenHash },
      include: { admin: { select: { name: true, email: true, active: true } }, agency: { select: { name: true } } },
    });
    if (ai && !ai.usedAt && ai.expiresAt >= new Date() && ai.admin.active) {
      person = { name: ai.admin.name, email: ai.admin.email, phone: null, agency: ai.agency.name };
    }
  }
  if (!person) throw new ValidationError(INVALID);
  const existing = await db.user.findUnique({ where: { email: person.email }, select: { id: true } });
  return {
    name: person.name,
    email: person.email,
    phone: normalizePhone(person.phone),
    agency: person.agency ?? null,
    hasAccount: !!existing,
  };
}

/**
 * Aceita o convite (roda com a conexão core_auth):
 *  - pessoa nova: cria usuário + senha;
 *  - pessoa que já tem conta (outro evento): só vincula; a senha não muda.
 * Liga a participação ao usuário pelo e-mail do convite, nunca por algo enviado.
 */
export async function acceptInvitation(db: PrismaClient, input: unknown, meta: { ip?: string | null } = {}) {
  const data = parse(acceptSchema, input);
  const tokenHash = hashToken(data.token);
  const whatsappPhone = data.whatsapp?.enabled ? normalizePhone(data.whatsapp.phone) : null;
  if (data.whatsapp?.enabled && !whatsappPhone) {
    throw new ValidationError("Telefone inválido para o WhatsApp. Use DDD + número, ex.: (11) 98765-4321");
  }

  return db.$transaction(async (tx) => {
    // Trava o convite para que dois aceites simultâneos não passem os dois.
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM invitations WHERE token_hash = ${tokenHash} AND used_at IS NULL FOR UPDATE`;
    if (!rows[0]) return acceptAgencyInvitation(tx, tokenHash, data.password, meta);
    const inv = rows[0]
      ? await tx.invitation.findUnique({ where: { id: rows[0].id }, include: { participant: true } })
      : null;
    if (!inv || inv.expiresAt < new Date() || !inv.participant.active || inv.participant.deletedAt) {
      throw new ValidationError(INVALID);
    }

    const email = inv.participant.email.toLowerCase();
    let user = await tx.user.findUnique({ where: { email } });
    const newAccount = !user;
    if (user && !user.active) throw new ValidationError("Usuário desativado. Fale com o gerente do evento.");

    if (!user) {
      user = await tx.user.create({ data: { email, name: inv.participant.name, emailVerified: true } });
      await tx.account.create({
        data: { userId: user.id, accountId: user.id, providerId: "credential", password: await hashPassword(data.password) },
      });
    }

    if (inv.participant.userId && inv.participant.userId !== user.id) throw new ValidationError(INVALID);

    await tx.participant.update({
      where: { id: inv.participantId },
      data: { userId: user.id, joinedAt: inv.participant.joinedAt ?? new Date() },
    });
    await tx.invitation.update({ where: { id: inv.id }, data: { usedAt: new Date() } });
    if (whatsappPhone) {
      await tx.whatsappContact.upsert({
        where: { userId: user.id },
        create: { userId: user.id, phone: whatsappPhone, optedInAt: new Date() },
        update: { phone: whatsappPhone, optedInAt: new Date(), updatedAt: new Date() },
      });
    }
    await tx.auditLog.createMany({
      data: {
        actorUserId: user.id, eventId: inv.eventId, entity: "participant", entityId: inv.participantId,
        action: "UPDATE", after: { invitationAccepted: true, whatsapp: !!whatsappPhone }, ip: meta.ip && isIP(meta.ip) ? meta.ip : null,
      },
    });
    return { email, userId: user.id, newAccount };
  });
}

type AuthTx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/** Pessoa nova ganha conta e senha; quem já tem conta só é ligado (a senha não muda). */
async function findOrCreateUser(tx: AuthTx, email: string, name: string, password: string) {
  let user = await tx.user.findUnique({ where: { email } });
  if (user && !user.active) throw new ValidationError("Usuário desativado. Fale com quem cadastrou você.");
  const newAccount = !user;
  if (!user) {
    user = await tx.user.create({ data: { email, name, emailVerified: true } });
    await tx.account.create({
      data: { userId: user.id, accountId: user.id, providerId: "credential", password: await hashPassword(password) },
    });
  }
  return { user, newAccount };
}

/** Convite de Admin de agência: liga a conta ao cadastro de Admin. */
async function acceptAgencyInvitation(tx: AuthTx, tokenHash: string, password: string, meta: { ip?: string | null }) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM agency_invitations WHERE token_hash = ${tokenHash} AND used_at IS NULL FOR UPDATE`;
  const inv = rows[0] ? await tx.agencyInvitation.findUnique({ where: { id: rows[0].id }, include: { admin: true } }) : null;
  if (!inv || inv.expiresAt < new Date() || !inv.admin.active) throw new ValidationError(INVALID);

  const email = inv.admin.email.toLowerCase();
  const { user, newAccount } = await findOrCreateUser(tx, email, inv.admin.name, password);
  if (inv.admin.userId && inv.admin.userId !== user.id) throw new ValidationError(INVALID);

  await tx.agencyAdmin.update({ where: { id: inv.agencyAdminId }, data: { userId: user.id } });
  await tx.agencyInvitation.update({ where: { id: inv.id }, data: { usedAt: new Date() } });
  await tx.auditLog.createMany({
    data: {
      actorUserId: user.id, entity: "agency_admin", entityId: inv.agencyAdminId, action: "UPDATE",
      after: { invitationAccepted: true, agencyId: inv.agencyId }, ip: meta.ip && isIP(meta.ip) ? meta.ip : null,
    },
  });
  return { email, userId: user.id, newAccount };
}
