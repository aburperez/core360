import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "../../server/authz/actor";
import { canAssemble, canSendToField, canUseField, canUsePreProduction, isMe } from "../../server/authz/policy";
import { membershipFor } from "../../server/authz/actor";
import { audit } from "../../server/audit/audit";
import { ForbiddenError, NotFoundError, ValidationError } from "../../server/errors";
import type { Tx } from "../../server/db/with-user";
import { getStorage } from "../../server/storage/storage";
import { optionalText, parse, uuid } from "../../lib/validation";
import { parseDecimal } from "../../lib/money";
import { requireEventAccess } from "../events/events.service";
import { MAX_PHOTO_BYTES } from "../attachments/attachments.service";
import { sniffImage } from "../attachments/image";
import { fieldText } from "./field-text";

/**
 * Itens no campo: a planilha de custos (Pré-produção) alimenta o campo.
 * O Gerente escolhe quem recebe cada item e "envia para o campo"; quem recebe
 * confere e marca "chegou certo" ou "chegou diferente", acertando quantidade
 * e descrição. O campo NUNCA recebe valores: item_receipts é uma cópia sem
 * preços, e cost_items continua só da Pré-produção (serviço e RLS).
 */

/** Quem pode receber itens no campo. */
const RECEIVER_ROLES = ["GERENTE", "HEAD", "OPERACIONAL"] as const;

function requireSender(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canUsePreProduction(actor, eventId)) throw new NotFoundError("Pré-produção");
  if (!canSendToField(actor, eventId)) throw new ForbiddenError("Só o gerente escolhe quem recebe e envia para o campo");
}

/** Pessoas do campo que podem receber itens (para o Gerente escolher). */
export async function listReceiverOptions(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canSendToField(actor, eventId)) return [];
  return actor.run((tx) =>
    tx.participant.findMany({
      where: { eventId, active: true, deletedAt: null, role: { in: [...RECEIVER_ROLES] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true, jobTitle: true, area: { select: { name: true } }, team: { select: { name: true } } },
    }),
  );
}

async function checkReceiver(actor: Actor, eventId: string, participantId: string | null) {
  if (participantId === null) return null;
  const p = await actor.run((tx) =>
    tx.participant.findFirst({
      where: { id: participantId, eventId, active: true, deletedAt: null, role: { in: [...RECEIVER_ROLES] } },
      select: { id: true, name: true },
    }),
  );
  if (!p) throw new ValidationError("Escolha alguém do campo deste evento (Gerente, Head ou Operacional)");
  return p;
}

const receiverSchema = z.object({ participantId: uuid.nullable() });

/** Quem recebe este item no campo (vazio = ninguém). */
export async function setItemReceiver(actor: Actor, itemId: string, input: unknown) {
  const data = parse(receiverSchema, input);
  const item = uuid.safeParse(itemId).success ? await actor.run((tx) => tx.costItem.findUnique({ where: { id: itemId } })) : null;
  if (!item || !canUsePreProduction(actor, item.eventId)) throw new NotFoundError("Item");
  requireSender(actor, item.eventId);
  await checkReceiver(actor, item.eventId, data.participantId);
  return actor.run(async (tx) => {
    await tx.costItem.update({ where: { id: item.id }, data: { receiverId: data.participantId } });
    await audit(tx, actor, {
      eventId: item.eventId, entity: "cost_item", entityId: item.id, action: "UPDATE",
      before: { receiverId: item.receiverId }, after: { receiverId: data.participantId },
    });
    return { ok: true };
  });
}

/** A mesma pessoa recebe todos os itens da seção. */
export async function setSectionReceiver(actor: Actor, sectionId: string, input: unknown) {
  const data = parse(receiverSchema, input);
  const section = uuid.safeParse(sectionId).success ? await actor.run((tx) => tx.costSection.findUnique({ where: { id: sectionId } })) : null;
  if (!section || !canUsePreProduction(actor, section.eventId)) throw new NotFoundError("Seção");
  requireSender(actor, section.eventId);
  await checkReceiver(actor, section.eventId, data.participantId);
  return actor.run(async (tx) => {
    const r = await tx.costItem.updateMany({ where: { sectionId: section.id, eventId: section.eventId }, data: { receiverId: data.participantId } });
    await audit(tx, actor, {
      eventId: section.eventId, entity: "cost_section", entityId: section.id, action: "UPDATE",
      after: { receiverId: data.participantId, items: r.count },
    });
    return { ok: true, items: r.count };
  });
}

/**
 * Envia para o campo: cada item com alguém para receber vira (ou atualiza) um
 * recebimento SEM valores. Se o item mudou depois de enviado (nome, descritivo,
 * quantidade, seção ou pessoa), a conferência volta para "aguardando". Itens
 * que ficaram sem pessoa saem do campo.
 */
export async function sendToField(actor: Actor, eventId: string) {
  requireSender(actor, eventId);
  return actor.run(async (tx) => {
    const items = await tx.costItem.findMany({
      where: { eventId },
      select: { id: true, name: true, description: true, quantity: true, unit: true, location: true, receiverId: true, section: { select: { name: true } } },
      orderBy: [{ section: { position: "asc" } }, { position: "asc" }],
    });
    const receipts = await tx.itemReceipt.findMany({ where: { eventId } });
    const byItem = new Map(receipts.map((r) => [r.costItemId, r]));
    const now = new Date();
    let created = 0, updated = 0, unchanged = 0;
    for (const [position, it] of items.entries()) {
      if (!it.receiverId) continue;
      const snap = {
        receiverId: it.receiverId,
        sectionName: it.section.name,
        name: fieldText(it.name),
        description: fieldText(it.description),
        quantity: it.quantity,
        unit: it.unit,
        location: it.location,
      };
      const r = byItem.get(it.id);
      if (!r) {
        await tx.itemReceipt.create({ data: { ...snap, position, eventId, costItemId: it.id, sentAt: now, sentById: actor.userId } });
        created++;
      } else if (
        r.receiverId !== snap.receiverId || r.sectionName !== snap.sectionName || r.name !== snap.name
        || r.description !== snap.description || Number(r.quantity) !== Number(snap.quantity)
        || r.unit !== snap.unit || r.location !== snap.location
      ) {
        await tx.itemReceipt.update({
          where: { id: r.id },
          data: {
            ...snap, position, sentAt: now, sentById: actor.userId,
            status: "PENDENTE", receivedQuantity: null, receivedDescription: null, note: null, receivedAt: null, receivedById: null,
            assembledAt: null, assembledById: null, checkedAt: null, checkedById: null,
          },
        });
        updated++;
      } else {
        // Só mudou a ordem na planilha: acompanha sem desfazer a conferência.
        if (r.position !== position) await tx.itemReceipt.update({ where: { id: r.id }, data: { position } });
        unchanged++;
      }
    }
    const keep = new Set(items.filter((i) => i.receiverId).map((i) => i.id));
    const gone = receipts.filter((r) => !keep.has(r.costItemId)).map((r) => r.id);
    if (gone.length) await tx.itemReceipt.deleteMany({ where: { id: { in: gone } } });
    const result = { created, updated, unchanged, removed: gone.length, withoutReceiver: items.filter((i) => !i.receiverId).length };
    await audit(tx, actor, { eventId, entity: "cost_sheet", entityId: eventId, action: "UPDATE", after: { sentToField: result } });
    return result;
  });
}

const receiptSelect = {
  id: true, eventId: true, costItemId: true, receiverId: true, sectionName: true, name: true, description: true, quantity: true,
  unit: true, location: true, status: true, receivedQuantity: true, receivedDescription: true, note: true, receivedAt: true, sentAt: true,
  areaId: true, assembledAt: true, checkedAt: true,
  receiver: { select: { name: true } },
  area: { select: { name: true } },
  photos: { select: { id: true, stage: true }, orderBy: { createdAt: "asc" as const } },
} as const;

type ReceiptRow = {
  eventId: string; receiverId: string; areaId: string | null;
  quantity: unknown; receivedQuantity: unknown; photos: { id: string; stage: string }[]; receiver: { name: string }; area: { name: string } | null;
} & Record<string, unknown>;

const plain = <T extends ReceiptRow>(actor: Actor, r: T) => ({
  ...r,
  quantity: Number(r.quantity),
  receivedQuantity: r.receivedQuantity === null ? null : Number(r.receivedQuantity),
  receiverName: r.receiver.name,
  areaName: r.area?.name ?? null,
  photoIds: r.photos.filter((p) => p.stage === "RECEBIMENTO").map((p) => p.id),
  checkPhotoIds: r.photos.filter((p) => p.stage === "CONFERIDO").map((p) => p.id),
  /** Pode marcar a chegada (quem recebe ou o gestor). */
  canReceive: canSendToField(actor, r.eventId) || isMe(actor, r.eventId, r.receiverId),
  /** Pode marcar Montado e Conferido (Head da área ou o gestor). */
  canAssemble: canAssemble(actor, r.eventId, r.areaId),
});

/** Área de quem é Head neste evento (vê e monta os itens dela). */
const headArea = (actor: Actor, eventId: string) => {
  const m = membershipFor(actor, eventId);
  return m?.role === "HEAD" ? m.areaId : null;
};

/** Quem vê quais recebimentos: o gestor todos; os outros os seus e, o Head, os da área dele. */
function visibleWhere(actor: Actor, eventId: string) {
  if (canSendToField(actor, eventId)) return {};
  const me = actor.memberships.find((m) => m.eventId === eventId)?.participantId;
  const area = headArea(actor, eventId);
  const or = [...(me ? [{ receiverId: me }] : []), ...(area ? [{ areaId: area }] : [])];
  return or.length ? { OR: or } : null;
}

/**
 * Recebimentos no campo. Quem recebe vê os seus; o Head da área vê os da
 * área (para marcar Montado e Conferido); o gestor vê todos do evento.
 * Nada aqui tem valor: a tabela nem guarda preço.
 */
export async function listReceipts(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canUseField(actor, eventId)) throw new NotFoundError("Recebimentos");
  const all = canSendToField(actor, eventId);
  const where = visibleWhere(actor, eventId);
  if (!where) return { all, rows: [] };
  const rows = await actor.run((tx) =>
    tx.itemReceipt.findMany({
      where: { eventId, ...where },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: receiptSelect,
    }),
  );
  return { all, rows: rows.map((r) => plain(actor, r)) };
}

/** Quantos itens a pessoa ainda precisa conferir (aviso no início e no menu). */
export async function countMyPendingReceipts(actor: Actor, eventId: string) {
  const me = actor.memberships.find((m) => m.eventId === eventId)?.participantId;
  if (!me || !canUseField(actor, eventId)) return 0;
  return actor.run((tx) => tx.itemReceipt.count({ where: { eventId, receiverId: me, status: "PENDENTE" } }));
}

/** Há recebimentos para esta pessoa (ou, para o gestor, no evento)? Mostra o atalho. */
export async function hasReceipts(actor: Actor, eventId: string) {
  if (!canUseField(actor, eventId)) return false;
  const where = visibleWhere(actor, eventId);
  if (!where) return false;
  const n = await actor.run((tx) => tx.itemReceipt.count({ where: { eventId, ...where } }));
  return n > 0;
}

async function loadReceipt(actor: Actor, id: string) {
  const r = uuid.safeParse(id).success ? await actor.run((tx) => tx.itemReceipt.findUnique({ where: { id } })) : null;
  if (!r || !(isMe(actor, r.eventId, r.receiverId) || canAssemble(actor, r.eventId, r.areaId))) throw new NotFoundError("Item");
  return r;
}

const qty = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() === "" ? null : (parseDecimal(v) ?? v)) : v),
  z.number({ message: "Quantidade inválida" }).min(0, "Não pode ser negativa").max(1e8).nullable(),
);

const checkSchema = z
  .object({
    status: z.enum(["OK", "DIFERENTE", "PENDENTE"]),
    receivedQuantity: qty.optional(),
    receivedDescription: optionalText(2000),
    note: optionalText(1000),
  })
  .refine((v) => v.status !== "DIFERENTE" || v.note, { message: "Conte o que chegou diferente", path: ["note"] });

/**
 * Conferência de quem recebe: "chegou certo", "chegou diferente" (com a
 * quantidade e a descrição do que chegou, e a explicação) ou desfazer.
 */
export async function checkReceipt(actor: Actor, id: string, input: unknown) {
  const data = parse(checkSchema, input);
  const r = await loadReceipt(actor, id);
  if (!(isMe(actor, r.eventId, r.receiverId) || canSendToField(actor, r.eventId))) throw new ForbiddenError("Só quem recebe confere a chegada");
  if (data.status === "PENDENTE" && r.assembledAt) throw new ValidationError("O item já está montado. Desfaça o Montado antes.");
  const patch = data.status === "PENDENTE"
    ? { status: "PENDENTE" as const, receivedQuantity: null, receivedDescription: null, note: null, receivedAt: null, receivedById: null }
    : {
        status: data.status,
        receivedQuantity: data.status === "DIFERENTE" ? (data.receivedQuantity ?? null) : null,
        receivedDescription: data.status === "DIFERENTE" ? data.receivedDescription : null,
        note: data.note,
        receivedAt: new Date(),
        receivedById: actor.userId,
      };
  return actor.run(async (tx) => {
    const saved = await tx.itemReceipt.update({ where: { id: r.id }, data: patch, select: receiptSelect });
    await audit(tx, actor, {
      eventId: r.eventId, entity: "item_receipt", entityId: r.id, action: "VALIDATE",
      before: { status: r.status }, after: { status: patch.status, receivedQuantity: patch.receivedQuantity, note: patch.note },
    });
    return plain(actor, saved);
  });
}

type Photo = { id: string; storageKey: string; mime: string; bytes: Uint8Array; sha256: string };

/** Confere a foto e, fora do banco (R2), já guarda os bytes. */
async function preparePhoto(r: { id: string; eventId: string }, bytes: Uint8Array): Promise<Photo> {
  if (bytes.length === 0) throw new ValidationError("Arquivo vazio");
  if (bytes.length > MAX_PHOTO_BYTES) throw new ValidationError("Foto maior que 10 MB");
  const image = sniffImage(bytes);
  if (!image) throw new ValidationError("Envie uma foto (JPEG, PNG, WebP ou HEIC)");
  const id = randomUUID();
  const storageKey = `events/${r.eventId}/receipts/${r.id}/${id}.${image.ext}`;
  const storage = getStorage();
  if (!storage.inDatabase) await storage.put(storageKey, bytes, image.mime);
  return { id, storageKey, mime: image.mime, bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function insertPhoto(tx: Tx, actor: Actor, r: { id: string; eventId: string }, p: Photo, stage: "RECEBIMENTO" | "CONFERIDO") {
  const storage = getStorage();
  if (storage.inDatabase) await storage.put(p.storageKey, p.bytes, p.mime, tx);
  await tx.receiptPhoto.create({
    data: { id: p.id, eventId: r.eventId, receiptId: r.id, storageKey: p.storageKey, mimeType: p.mime, sizeBytes: p.bytes.length, sha256: p.sha256, stage, uploadedById: actor.userId },
  });
}

/** Foto da conferência (ex.: o item que chegou diferente). */
export async function addReceiptPhoto(actor: Actor, id: string, bytes: Uint8Array) {
  const r = await loadReceipt(actor, id);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const existing = await actor.run((tx) => tx.receiptPhoto.findUnique({ where: { receiptId_sha256: { receiptId: r.id, sha256 } } }));
  if (existing) return { id: existing.id };
  const photo = await preparePhoto(r, bytes);
  return actor.run(async (tx) => {
    await insertPhoto(tx, actor, r, photo, "RECEBIMENTO");
    await audit(tx, actor, { eventId: r.eventId, entity: "item_receipt", entityId: r.id, action: "UPDATE", after: { photoAdded: photo.id } });
    return { id: photo.id };
  });
}

async function loadForAssembly(actor: Actor, id: string) {
  const r = await loadReceipt(actor, id);
  if (!canAssemble(actor, r.eventId, r.areaId)) throw new ForbiddenError("Só o Head da área do item ou o gerente marca a montagem");
  return r;
}

/**
 * Fase 5B: o Head da área (ou o gerente) marca o item Montado, depois que
 * ele chegou, ou desfaz. O banco põe o item em Montado (ou volta para No local).
 */
export async function setAssembled(actor: Actor, id: string, input: unknown) {
  const { done } = parse(z.object({ done: z.boolean() }), input);
  const r = await loadForAssembly(actor, id);
  if (done && r.status === "PENDENTE") throw new ValidationError("Marque primeiro a chegada do item");
  if (!done && r.checkedAt) throw new ValidationError("O item já está conferido. Desfaça o Conferido antes.");
  if (!!r.assembledAt === done) return { id: r.id, assembled: done };
  return actor.run(async (tx) => {
    await tx.itemReceipt.update({
      where: { id: r.id },
      data: done ? { assembledAt: new Date(), assembledById: actor.userId } : { assembledAt: null, assembledById: null },
    });
    await audit(tx, actor, { eventId: r.eventId, entity: "item_receipt", entityId: r.id, action: "STATUS_CHANGE", before: { assembled: !done }, after: { assembled: done, name: r.name } });
    return { id: r.id, assembled: done };
  });
}

/**
 * Conferido: só com uma foto, tirada na hora, que fica junto do item. O banco
 * repete a regra e põe o item em Conferido.
 */
export async function markChecked(actor: Actor, id: string, bytes: Uint8Array) {
  const r = await loadForAssembly(actor, id);
  if (!r.assembledAt) throw new ValidationError("Marque primeiro o item como Montado");
  if (r.checkedAt) return { id: r.id, checked: true };
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const existing = await actor.run((tx) => tx.receiptPhoto.findUnique({ where: { receiptId_sha256: { receiptId: r.id, sha256 } } }));
  if (existing && existing.stage !== "CONFERIDO") throw new ValidationError("Essa foto já está no item. Tire uma foto nova da montagem.");
  const photo = existing ? null : await preparePhoto(r, bytes);
  return actor.run(async (tx) => {
    if (photo) await insertPhoto(tx, actor, r, photo, "CONFERIDO");
    await tx.itemReceipt.update({ where: { id: r.id }, data: { checkedAt: new Date(), checkedById: actor.userId } });
    await audit(tx, actor, {
      eventId: r.eventId, entity: "item_receipt", entityId: r.id, action: "STATUS_CHANGE",
      before: { checked: false }, after: { checked: true, name: r.name, photo: photo?.id ?? existing?.id },
    });
    return { id: r.id, checked: true };
  });
}

/** Desfaz o Conferido (a foto fica no histórico do item). */
export async function uncheck(actor: Actor, id: string) {
  const r = await loadForAssembly(actor, id);
  if (!r.checkedAt) return { id: r.id, checked: false };
  return actor.run(async (tx) => {
    await tx.itemReceipt.update({ where: { id: r.id }, data: { checkedAt: null, checkedById: null } });
    await audit(tx, actor, { eventId: r.eventId, entity: "item_receipt", entityId: r.id, action: "STATUS_CHANGE", before: { checked: true }, after: { checked: false, name: r.name } });
    return { id: r.id, checked: false };
  });
}

async function loadPhoto(actor: Actor, photoId: string) {
  const p = uuid.safeParse(photoId).success
    ? await actor.run((tx) => tx.receiptPhoto.findUnique({ where: { id: photoId }, include: { receipt: true } }))
    : null;
  const ok = p && (isMe(actor, p.eventId, p.receipt.receiverId) || canUsePreProduction(actor, p.eventId) || canAssemble(actor, p.eventId, p.receipt.areaId));
  if (!p || !ok) throw new NotFoundError("Foto");
  return p;
}

/** Bytes (fotos no banco/memória) ou link assinado (R2), sempre depois de conferir o acesso. */
export async function receiptPhoto(actor: Actor, photoId: string) {
  const p = await loadPhoto(actor, photoId);
  const storage = getStorage();
  if (storage.get) {
    const get = storage.get.bind(storage);
    const body = storage.inDatabase ? await actor.run((tx) => get(p.storageKey, tx)) : await get(p.storageKey);
    if (!body) throw new NotFoundError("Foto");
    return { body, mimeType: p.mimeType, url: null };
  }
  return { body: null, mimeType: p.mimeType, url: await storage.signedUrl(p.storageKey) };
}
