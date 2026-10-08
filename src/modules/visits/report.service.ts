import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "../../server/authz/actor";
import { canUsePreProduction } from "../../server/authz/policy";
import { audit, diff } from "../../server/audit/audit";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../server/errors";
import { isUniqueViolation, pgErrorCode } from "../../server/db/errors";
import type { Tx } from "../../server/db/with-user";
import { getStorage } from "../../server/storage/storage";
import { optionalText, parse, uuid } from "../../lib/validation";
import { MAX_PHOTO_BYTES } from "../attachments/attachments.service";
import { sniffImage } from "../attachments/image";
import { canEdit, requireOpen } from "./visits.service";

/**
 * Relatório da visita técnica: o briefing do lugar, preenchido no local, e as
 * fotos com legenda. Toda a Pré-produção vê; mexe quem já mexe na visita (o
 * gestor, quem marcou ou quem vai). Para concluir, pelo menos 10 fotos; no
 * máximo 40. Concluída, fica travada até alguém reabrir. A RLS e os gatilhos
 * da migration *_visita_relatorio repetem cada regra no banco.
 */

export const MIN_VISIT_PHOTOS = 10;
export const MAX_VISIT_PHOTOS = 40;

/** Campos do briefing do lugar, na ordem do relatório. */
export const PLACE_FIELDS = [
  { key: "accessText", label: "Acesso e carga/descarga", hint: "Portões, horários, altura e peso, rampas, elevador de carga, estacionamento." },
  { key: "powerText", label: "Energia", hint: "Quadros e pontos de força, voltagem, potência disponível, gerador." },
  { key: "internetText", label: "Internet e sinal", hint: "Wi-Fi do local, cabo, sinal de celular por operadora." },
  { key: "facilitiesText", label: "Banheiros e apoio", hint: "Banheiros, camarins, copa, depósito, água." },
  { key: "restrictionsText", label: "Restrições do local", hint: "Horários, barulho, fixação em paredes e piso, fumaça, regras do condomínio." },
  { key: "contactsText", label: "Contatos do local", hint: "Nome, função e telefone de quem atende no local." },
  { key: "observations", label: "Observações", hint: "Tudo o que mais a equipe precisa saber." },
] as const;

export type PlaceField = (typeof PLACE_FIELDS)[number]["key"];

const visitSelect = {
  id: true, eventId: true, title: true, place: true, scheduledAt: true, responsibleId: true, ppe: true, ppeOther: true, notes: true,
  address: true, people: true, accessText: true, powerText: true, internetText: true, facilitiesText: true, restrictionsText: true,
  contactsText: true, observations: true, status: true, concludedAt: true, createdById: true,
  responsible: { select: { id: true, name: true, role: true } },
} as const;

async function loadVisit(actor: Actor, tx: Tx, visitId: string) {
  const v = uuid.safeParse(visitId).success ? await tx.technicalVisit.findUnique({ where: { id: visitId }, select: visitSelect }) : null;
  if (!v || !canUsePreProduction(actor, v.eventId)) throw new NotFoundError("Visita técnica");
  return v;
}

function requireEditor(actor: Actor, v: { eventId: string; createdById: string; responsibleId: string }) {
  if (!canEdit(actor, v)) throw new ForbiddenError("Só o gestor, quem marcou ou quem vai preenche o relatório");
}

/** As regras do banco (gatilhos) viram mensagens para a pessoa. */
async function rules<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (pgErrorCode(e) === "23514") {
      const msg = String((e as { message?: string }).message ?? "");
      if (msg.includes("40 fotos")) throw new ValidationError(`No máximo ${MAX_VISIT_PHOTOS} fotos por visita`);
      if (msg.includes("10 fotos")) throw new ValidationError(`Para concluir, envie pelo menos ${MIN_VISIT_PHOTOS} fotos`);
      throw new ConflictError("Visita concluída. Para mudar, reabra a visita.");
    }
    throw e;
  }
}

/** A visita com o relatório e as fotos (na ordem), para a página e o relatório. */
export async function getVisitReport(actor: Actor, visitId: string) {
  return actor.run(async (tx) => {
    const v = await loadVisit(actor, tx, visitId);
    const photos = await tx.technicalVisitPhoto.findMany({
      where: { visitId: v.id },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true, caption: true },
    });
    return { ...v, photos, canEdit: canEdit(actor, v), canConclude: photos.length >= MIN_VISIT_PHOTOS };
  });
}

const reportSchema = z.object({
  address: optionalText(300),
  people: optionalText(500),
  accessText: optionalText(4000),
  powerText: optionalText(4000),
  internetText: optionalText(4000),
  facilitiesText: optionalText(4000),
  restrictionsText: optionalText(4000),
  contactsText: optionalText(4000),
  observations: optionalText(4000),
});

/** Salvar o briefing do lugar (só com a visita aberta). */
export async function updateReport(actor: Actor, visitId: string, input: unknown) {
  const data = parse(reportSchema.partial(), input);
  const sent = (input ?? {}) as Record<string, unknown>;
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => k in sent));
  return actor.run(async (tx) => {
    const v = await loadVisit(actor, tx, visitId);
    requireEditor(actor, v);
    requireOpen(v);
    const changes = diff(v as unknown as Record<string, unknown>, patch);
    if (!Object.keys(changes.after).length) return { id: v.id };
    await rules(() => tx.technicalVisit.update({ where: { id: v.id }, data: patch }));
    await audit(tx, actor, { eventId: v.eventId, entity: "technical_visit", entityId: v.id, action: "UPDATE", ...changes });
    return { id: v.id };
  });
}

const statusSchema = z.object({ status: z.enum(["CONCLUIDA", "ABERTA"]) });

/** Concluir (pede 10 fotos) ou reabrir. */
export async function setVisitStatus(actor: Actor, visitId: string, input: unknown) {
  const { status } = parse(statusSchema, input);
  return actor.run(async (tx) => {
    const v = await loadVisit(actor, tx, visitId);
    requireEditor(actor, v);
    if (v.status === status) return { id: v.id, status };
    if (status === "CONCLUIDA") {
      const photos = await tx.technicalVisitPhoto.count({ where: { visitId: v.id } });
      if (photos < MIN_VISIT_PHOTOS) {
        throw new ValidationError(`Para concluir, envie pelo menos ${MIN_VISIT_PHOTOS} fotos (faltam ${MIN_VISIT_PHOTOS - photos})`);
      }
    }
    await rules(() =>
      tx.technicalVisit.update({ where: { id: v.id }, data: { status, concludedAt: status === "CONCLUIDA" ? new Date() : null } }),
    );
    await audit(tx, actor, {
      eventId: v.eventId, entity: "technical_visit", entityId: v.id,
      action: status === "CONCLUIDA" ? "CONCLUDE" : "STATUS_CHANGE",
      before: { status: v.status }, after: { status },
    });
    return { id: v.id, status };
  });
}

// ───────────────────────────── Fotos ─────────────────────────────

/** Uma foto da visita (já reduzida no celular). Repetida: devolve a que já existe. */
export async function addVisitPhoto(actor: Actor, visitId: string, bytes: Uint8Array, caption?: string | null) {
  const v = await actor.run((tx) => loadVisit(actor, tx, visitId));
  requireEditor(actor, v);
  requireOpen(v);
  if (bytes.length === 0) throw new ValidationError("Arquivo vazio");
  if (bytes.length > MAX_PHOTO_BYTES) throw new ValidationError("Foto maior que 10 MB");
  const image = sniffImage(bytes);
  if (!image) throw new ValidationError("Envie uma foto (JPEG, PNG, WebP ou HEIC)");
  const legend = parse(optionalText(300), caption);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const find = () => actor.run((tx) => tx.technicalVisitPhoto.findUnique({ where: { visitId_sha256: { visitId: v.id, sha256 } }, select: { id: true } }));
  const existing = await find();
  if (existing) return { id: existing.id, duplicate: true };
  const count = await actor.run((tx) => tx.technicalVisitPhoto.count({ where: { visitId: v.id } }));
  if (count >= MAX_VISIT_PHOTOS) throw new ValidationError(`No máximo ${MAX_VISIT_PHOTOS} fotos por visita`);

  const photoId = randomUUID();
  const storageKey = `events/${v.eventId}/visits/${v.id}/${photoId}.${image.ext}`;
  const storage = getStorage();
  if (!storage.inDatabase) await storage.put(storageKey, bytes, image.mime);
  try {
    return await actor.run(async (tx) => {
      if (storage.inDatabase) await storage.put(storageKey, bytes, image.mime, tx);
      const last = await tx.technicalVisitPhoto.aggregate({ where: { visitId: v.id }, _max: { position: true } });
      await rules(() =>
        tx.technicalVisitPhoto.create({
          data: {
            id: photoId, eventId: v.eventId, visitId: v.id, storageKey, mimeType: image.mime, sizeBytes: bytes.length, sha256,
            caption: legend, position: (last._max.position ?? -1) + 1, uploadedById: actor.userId,
          },
        }),
      );
      await audit(tx, actor, { eventId: v.eventId, entity: "technical_visit", entityId: v.id, action: "UPDATE", after: { photoAdded: photoId } });
      return { id: photoId, duplicate: false };
    });
  } catch (e) {
    // Duas cópias da mesma foto ao mesmo tempo: fica a primeira.
    if (isUniqueViolation(e)) {
      const again = await find();
      if (again) return { id: again.id, duplicate: true };
    }
    throw e;
  }
}

async function loadPhoto(actor: Actor, tx: Tx, photoId: string) {
  const p = uuid.safeParse(photoId).success
    ? await tx.technicalVisitPhoto.findUnique({
        where: { id: photoId },
        include: { visit: { select: { eventId: true, status: true, createdById: true, responsibleId: true } } },
      })
    : null;
  if (!p || !canUsePreProduction(actor, p.eventId)) throw new NotFoundError("Foto");
  return p;
}

const photoSchema = z.object({ caption: optionalText(300) });

/** Legenda da foto (só com a visita aberta). */
export async function updatePhotoCaption(actor: Actor, photoId: string, input: unknown) {
  const { caption } = parse(photoSchema, input);
  return actor.run(async (tx) => {
    const p = await loadPhoto(actor, tx, photoId);
    requireEditor(actor, p.visit);
    requireOpen(p.visit);
    await rules(() => tx.technicalVisitPhoto.update({ where: { id: p.id }, data: { caption } }));
    return { id: p.id, caption };
  });
}

/** Tirar a foto da visita (só com a visita aberta). */
export async function deleteVisitPhoto(actor: Actor, photoId: string) {
  return actor.run(async (tx) => {
    const p = await loadPhoto(actor, tx, photoId);
    requireEditor(actor, p.visit);
    requireOpen(p.visit);
    await rules(() => tx.technicalVisitPhoto.delete({ where: { id: p.id } }));
    await audit(tx, actor, { eventId: p.eventId, entity: "technical_visit", entityId: p.visitId, action: "UPDATE", after: { photoRemoved: p.id } });
    return { ok: true };
  });
}

/** Abre a foto, depois de conferir o acesso. */
export async function visitPhoto(actor: Actor, photoId: string) {
  const p = await actor.run((tx) => loadPhoto(actor, tx, photoId));
  const storage = getStorage();
  if (storage.get) {
    const get = storage.get.bind(storage);
    const body = storage.inDatabase ? await actor.run((tx) => get(p.storageKey, tx)) : await get(p.storageKey);
    if (!body) throw new NotFoundError("Foto");
    return { body, mimeType: p.mimeType, url: null };
  }
  return { body: null, mimeType: p.mimeType, url: await storage.signedUrl(p.storageKey) };
}
