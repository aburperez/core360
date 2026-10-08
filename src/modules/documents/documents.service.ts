import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "../../server/authz/actor";
import { canReviewSla, canUseField, canUsePreProduction } from "../../server/authz/policy";
import { audit, diff } from "../../server/audit/audit";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../server/errors";
import { isUniqueViolation } from "../../server/db/errors";
import type { Tx } from "../../server/db/with-user";
import { getStorage } from "../../server/storage/storage";
import { optionalText, parse, uuid } from "../../lib/validation";
import { DOCUMENT_CATEGORIES, formatBytes, type DocumentCategoryKey } from "../../lib/documents";
import { requireEventAccess } from "../events/events.service";
import { maxDocumentBytes, sniffDocument } from "./file";

/**
 * Central de documentos do evento. A Pré-produção (Gerente, Pré-produtor e
 * Admin) envia e vê todos; quem enviou ou o gestor apaga. O gestor (Gerente ou
 * Admin) libera um documento para o campo, que só lê. A RLS e os gatilhos da
 * migration *_documentos_evento repetem cada regra no banco.
 */

export const MAX_DOCUMENTS_PER_EVENT = 500;

const category = z.enum(DOCUMENT_CATEGORIES.map((c) => c.key) as [DocumentCategoryKey, ...DocumentCategoryKey[]], {
  message: "Escolha a categoria",
});

const listSelect = {
  id: true, eventId: true, category: true, title: true, fileName: true, mimeType: true, sizeBytes: true,
  visibleToField: true, uploadedById: true, createdAt: true,
} as const;
const docSelect = { ...listSelect, storageKey: true } as const;

function requirePre(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canUsePreProduction(actor, eventId)) throw new NotFoundError("Pré-produção");
}

/** Pode apagar: quem enviou ou o gestor. */
const canDelete = (actor: Actor, d: { eventId: string; uploadedById: string }) =>
  canReviewSla(actor, d.eventId) || d.uploadedById === actor.userId;

/** Todos os documentos (Pré-produção), com quem enviou. */
export async function listDocuments(actor: Actor, eventId: string) {
  requirePre(actor, eventId);
  return actor.run(async (tx) => {
    const docs = await tx.eventDocument.findMany({ where: { eventId }, orderBy: [{ createdAt: "desc" }], select: listSelect });
    const names = await uploaderNames(tx, docs.map((d) => d.uploadedById));
    return {
      documents: docs.map((d) => ({
        ...d, uploadedBy: names.get(d.uploadedById) ?? "—", canDelete: canDelete(actor, d),
      })),
      canRelease: canReviewSla(actor, eventId),
      maxBytes: maxDocumentBytes(),
    };
  });
}

/** Nomes de quem enviou; quem a pessoa não enxerga fica sem nome. */
async function uploaderNames(tx: Tx, ids: string[]) {
  const users = await tx.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

/** Só os liberados para o campo (Gestão de campo › Documentos). */
export async function listFieldDocuments(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canUseField(actor, eventId)) throw new NotFoundError("Documentos");
  return actor.run((tx) =>
    tx.eventDocument.findMany({
      where: { eventId, visibleToField: true },
      orderBy: [{ createdAt: "desc" }],
      select: { id: true, category: true, title: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true },
    }),
  );
}

/** Quantos documentos o campo pode ler (para o atalho no painel). */
export async function fieldDocumentCount(actor: Actor, eventId: string) {
  if (!canUseField(actor, eventId)) return 0;
  return actor.run((tx) => tx.eventDocument.count({ where: { eventId, visibleToField: true } }));
}

const addSchema = z.object({
  category,
  title: optionalText(200),
  visibleToField: z.boolean().default(false),
});

export type DocumentUpload = { bytes: Uint8Array; name: string };

/** Enviar um documento. O mesmo arquivo duas vezes no evento: avisa qual já existe. */
export async function addDocument(actor: Actor, eventId: string, input: unknown, file: DocumentUpload) {
  requirePre(actor, eventId);
  const data = parse(addSchema, input);
  if (data.visibleToField && !canReviewSla(actor, eventId)) throw new ForbiddenError("Só o gestor libera documentos para o campo");
  const max = maxDocumentBytes();
  if (file.bytes.length === 0) throw new ValidationError("Arquivo vazio");
  if (file.bytes.length > max) throw new ValidationError(`Arquivo maior que ${formatBytes(max)}`);
  const kind = sniffDocument(file.bytes, file.name);
  if (!kind) throw new ValidationError("Envie PDF, imagem, Word, Excel ou PowerPoint");
  const fileName = file.name.replace(/[\\/\r\n"]/g, "_").trim().slice(0, 200) || `documento.${kind.ext}`;
  const title = data.title ?? (fileName.replace(/\.[^.]+$/, "").trim() || fileName);
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");

  const existing = () => actor.run((tx) => tx.eventDocument.findUnique({ where: { eventId_sha256: { eventId, sha256 } }, select: { title: true } }));
  const dup = await existing();
  if (dup) throw new ConflictError(`Esse arquivo já está nos documentos: ${dup.title}`);
  const count = await actor.run((tx) => tx.eventDocument.count({ where: { eventId } }));
  if (count >= MAX_DOCUMENTS_PER_EVENT) throw new ValidationError(`No máximo ${MAX_DOCUMENTS_PER_EVENT} documentos por evento`);

  const id = randomUUID();
  const storageKey = `events/${eventId}/documents/${id}.${kind.ext}`;
  const storage = getStorage();
  if (!storage.inDatabase) await storage.put(storageKey, file.bytes, kind.mime);
  try {
    return await actor.run(async (tx) => {
      if (storage.inDatabase) await storage.put(storageKey, file.bytes, kind.mime, tx);
      await tx.eventDocument.create({
        data: {
          id, eventId, category: data.category, title, fileName, mimeType: kind.mime, sizeBytes: file.bytes.length, sha256, storageKey,
          visibleToField: data.visibleToField, uploadedById: actor.userId,
        },
      });
      await audit(tx, actor, { eventId, entity: "event_document", entityId: id, action: "CREATE", after: { title, category: data.category, fileName, visibleToField: data.visibleToField } });
      return { id };
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const again = await existing();
      if (again) throw new ConflictError(`Esse arquivo já está nos documentos: ${again.title}`);
    }
    throw e;
  }
}

async function loadDocument(actor: Actor, tx: Tx, docId: string) {
  const d = uuid.safeParse(docId).success ? await tx.eventDocument.findUnique({ where: { id: docId }, select: docSelect }) : null;
  // A RLS já esconde o que a pessoa não pode ler; a checagem aqui repete a regra.
  if (!d || !(canUsePreProduction(actor, d.eventId) || (d.visibleToField && canUseField(actor, d.eventId)))) throw new NotFoundError("Documento");
  return d;
}

const updateSchema = z.object({ category, title: z.string().trim().min(1, "Dê um nome").max(200), visibleToField: z.boolean() }).partial();

/** Renomear, trocar a categoria ou liberar/esconder do campo (só o gestor). */
export async function updateDocument(actor: Actor, docId: string, input: unknown) {
  const data = parse(updateSchema, input);
  return actor.run(async (tx) => {
    const d = await loadDocument(actor, tx, docId);
    if (!canUsePreProduction(actor, d.eventId)) throw new ForbiddenError("Só a pré-produção muda documentos");
    if (data.visibleToField !== undefined && data.visibleToField !== d.visibleToField && !canReviewSla(actor, d.eventId)) {
      throw new ForbiddenError("Só o gestor libera documentos para o campo");
    }
    const changes = diff(d as unknown as Record<string, unknown>, data);
    if (!Object.keys(changes.after).length) return { id: d.id };
    await tx.eventDocument.update({ where: { id: d.id }, data });
    await audit(tx, actor, { eventId: d.eventId, entity: "event_document", entityId: d.id, action: "UPDATE", ...changes });
    return { id: d.id };
  });
}

/** Apagar: quem enviou ou o gestor. */
export async function deleteDocument(actor: Actor, docId: string) {
  return actor.run(async (tx) => {
    const d = await loadDocument(actor, tx, docId);
    if (!canUsePreProduction(actor, d.eventId) || !canDelete(actor, d)) throw new ForbiddenError("Só quem enviou ou o gestor apaga o documento");
    await tx.eventDocument.delete({ where: { id: d.id } });
    await audit(tx, actor, { eventId: d.eventId, entity: "event_document", entityId: d.id, action: "DELETE", before: { title: d.title, fileName: d.fileName } });
    return { ok: true };
  });
}

/** Bytes (no banco ou memória) ou link assinado (R2), sempre depois de conferir o acesso. */
export async function documentFile(actor: Actor, docId: string) {
  const d = await actor.run((tx) => loadDocument(actor, tx, docId));
  const inline = sniffInline(d.mimeType);
  const storage = getStorage();
  if (storage.get) {
    const get = storage.get.bind(storage);
    const body = storage.inDatabase ? await actor.run((tx) => get(d.storageKey, tx)) : await get(d.storageKey);
    if (!body) throw new NotFoundError("Arquivo");
    return { body, mimeType: d.mimeType, fileName: d.fileName, inline, url: null };
  }
  return { body: null, mimeType: d.mimeType, fileName: d.fileName, inline, url: await storage.signedUrl(d.storageKey) };
}

/** PDF e imagem abrem no navegador; Office baixa. */
const sniffInline = (mime: string) => mime === "application/pdf" || mime.startsWith("image/");
