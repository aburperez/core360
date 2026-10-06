import { createHash, randomUUID } from "node:crypto";
import type { Actor } from "../../server/authz/actor";
import { canSeeOccurrence } from "../../server/authz/policy";
import { audit } from "../../server/audit/audit";
import { NotFoundError, ValidationError } from "../../server/errors";
import { getStorage } from "../../server/storage/storage";
import { uuid } from "../../lib/validation";
import { sniffImage } from "./image";

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export interface UploadInput {
  bytes: Uint8Array;
  kind?: "EVIDENCIA" | "CONCLUSAO";
  width?: number | null;
  height?: number | null;
}

/**
 * Anexa uma foto à ocorrência. Quem vê a ocorrência pode anexar (a RLS também
 * exige isso). O tipo é conferido pelos bytes; a mesma foto enviada de novo
 * (ex.: re-sincronização offline) não duplica.
 */
export async function addPhoto(actor: Actor, occurrenceId: string, input: UploadInput) {
  if (!uuid.safeParse(occurrenceId).success) throw new NotFoundError("Ocorrência");
  const occ = await actor.run((tx) => tx.occurrence.findUnique({ where: { id: occurrenceId } }));
  if (!occ || !canSeeOccurrence(actor, occ)) throw new NotFoundError("Ocorrência");

  if (input.bytes.length === 0) throw new ValidationError("Arquivo vazio");
  if (input.bytes.length > MAX_PHOTO_BYTES) throw new ValidationError("Foto maior que 10 MB");
  const image = sniffImage(input.bytes);
  if (!image) throw new ValidationError("Envie uma foto (JPEG, PNG, WebP ou HEIC)");

  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const existing = await actor.run((tx) =>
    tx.attachment.findUnique({ where: { occurrenceId_sha256: { occurrenceId, sha256 } } }),
  );
  if (existing) return existing;

  const id = randomUUID();
  const storageKey = `events/${occ.eventId}/occurrences/${occ.id}/${id}.${image.ext}`;
  // Primeiro o arquivo, depois o registro: se o upload falhar, não fica registro órfão.
  await getStorage().put(storageKey, input.bytes, image.mime);

  return actor.run(async (tx) => {
    const a = await tx.attachment.create({
      data: {
        id, occurrenceId, eventId: occ.eventId, storageKey, mimeType: image.mime,
        sizeBytes: input.bytes.length, sha256, kind: input.kind ?? "EVIDENCIA",
        width: input.width ?? null, height: input.height ?? null, uploadedById: actor.userId,
      },
    });
    await audit(tx, actor, {
      eventId: occ.eventId, entity: "occurrence", entityId: occ.id, action: "UPDATE",
      after: { attachmentAdded: a.id, kind: a.kind },
    });
    return a;
  });
}

async function loadPhoto(actor: Actor, attachmentId: string) {
  if (!uuid.safeParse(attachmentId).success) throw new NotFoundError("Foto");
  const a = await actor.run((tx) =>
    tx.attachment.findFirst({ where: { id: attachmentId, deletedAt: null }, include: { occurrence: true } }),
  );
  if (!a || !canSeeOccurrence(actor, a.occurrence)) throw new NotFoundError("Foto");
  return a;
}

/** Link temporário para ver a foto, só depois de conferir o acesso. */
export async function photoUrl(actor: Actor, attachmentId: string) {
  const a = await loadPhoto(actor, attachmentId);
  return getStorage().signedUrl(a.storageKey);
}

/**
 * Para armazenamentos sem link assinado (memória, em dev/teste): devolve os
 * bytes diretamente, com a mesma checagem de acesso.
 */
export async function photoBytes(actor: Actor, attachmentId: string) {
  const storage = getStorage();
  if (!storage.get) return null;
  const a = await loadPhoto(actor, attachmentId);
  const body = await storage.get(a.storageKey);
  if (!body) throw new NotFoundError("Foto");
  return { body, mimeType: a.mimeType };
}
