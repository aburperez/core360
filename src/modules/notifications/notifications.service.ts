import { z } from "zod";
import type { Actor } from "../../server/authz/actor";
import { audit } from "../../server/audit/audit";
import { ValidationError } from "../../server/errors";
import { normalizePhone } from "../../lib/phone";
import { parse, uuid } from "../../lib/validation";

/** Avisos da própria pessoa. A RLS garante que ninguém lê avisos de outro. */
export async function listNotifications(actor: Actor) {
  return actor.run(async (tx) => {
    const [items, unread] = await Promise.all([
      tx.notification.findMany({
        where: { userId: actor.userId },
        orderBy: { createdAt: "desc" },
        take: 60,
        select: {
          id: true, type: true, title: true, body: true, readAt: true, createdAt: true, eventId: true, occurrenceId: true, link: true,
          event: { select: { name: true } },
        },
      }),
      tx.notification.count({ where: { userId: actor.userId, readAt: null } }),
    ]);
    return { items, unread };
  });
}

export async function unreadCount(actor: Actor) {
  return actor.run((tx) => tx.notification.count({ where: { userId: actor.userId, readAt: null } }));
}

const readSchema = z.object({ ids: z.array(uuid).max(200).optional() });

/** Marca como lidos (os informados, ou todos). */
export async function markRead(actor: Actor, input: unknown) {
  const { ids } = parse(readSchema, input ?? {});
  return actor.run(async (tx) => {
    const r = await tx.notification.updateMany({
      where: { userId: actor.userId, readAt: null, ...(ids && { id: { in: ids } }) },
      data: { readAt: new Date() },
    });
    return { updated: r.count };
  });
}

/**
 * Abrir um chamado conta como resposta aos avisos dele: marca como lidos e
 * para os lembretes do urgente. Chamado pela tela do chamado (inclusive quando
 * a pessoa chega pelo botão do WhatsApp).
 */
export async function markOccurrenceRead(actor: Actor, occurrenceId: string) {
  const id = parse(uuid, occurrenceId);
  return actor.run(async (tx) => {
    const r = await tx.notification.updateMany({
      where: { userId: actor.userId, occurrenceId: id, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: r.count };
  });
}

/** Número de WhatsApp e se a pessoa quer receber avisos por lá. */
export async function getWhatsappSettings(actor: Actor) {
  return actor.run(async (tx) => {
    const contact = await tx.whatsappContact.findUnique({ where: { userId: actor.userId } });
    if (contact) return { phone: contact.phone, enabled: !!contact.optedInAt };
    // Sugere o telefone cadastrado na equipe.
    const p = await tx.participant.findFirst({
      where: { userId: actor.userId, phone: { not: null } },
      orderBy: { updatedAt: "desc" },
      select: { phone: true },
    });
    return { phone: normalizePhone(p?.phone), enabled: false };
  });
}

const whatsappSchema = z.object({ phone: z.string().max(30).optional().nullable(), enabled: z.boolean() });

export async function setWhatsappSettings(actor: Actor, input: unknown) {
  const data = parse(whatsappSchema, input);
  return actor.run(async (tx) => {
    const current = await tx.whatsappContact.findUnique({ where: { userId: actor.userId } });
    const phone = data.phone ? normalizePhone(data.phone) : current?.phone ?? null;
    if (data.phone && !phone) throw new ValidationError("Telefone inválido. Use DDD + número, ex.: (11) 98765-4321");
    if (data.enabled && !phone) throw new ValidationError("Informe o número de WhatsApp");
    if (!phone) return { phone: null, enabled: false };

    const optedInAt = data.enabled ? (current?.optedInAt && current.phone === phone ? current.optedInAt : new Date()) : null;
    await tx.whatsappContact.upsert({
      where: { userId: actor.userId },
      create: { userId: actor.userId, phone, optedInAt },
      update: { phone, optedInAt, updatedAt: new Date() },
    });
    await audit(tx, actor, {
      entity: "user", entityId: actor.userId, action: "UPDATE",
      before: { whatsapp: !!current?.optedInAt }, after: { whatsapp: data.enabled },
    });
    return { phone, enabled: data.enabled };
  });
}
