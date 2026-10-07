import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "../../server/authz/actor";
import { membershipFor } from "../../server/authz/actor";
import { canEditPlanPoint, canManagePlans, canUseField, canWorkPlanPoint } from "../../server/authz/policy";
import { audit, diff } from "../../server/audit/audit";
import { ForbiddenError, NotFoundError, ValidationError } from "../../server/errors";
import { getStorage } from "../../server/storage/storage";
import { optionalText, parse, text, uuid } from "../../lib/validation";
import { DEFAULT_TZ, fromLocalInput } from "../../lib/tz";
import { requireEventAccess } from "../events/events.service";
import { MAX_PHOTO_BYTES } from "../attachments/attachments.service";
import { sniffImage } from "../attachments/image";
import { pointSituation } from "./situation";

export { pointSituation, type PointSituation } from "./situation";

/**
 * Planta do evento (Gestão de campo): o Gerente envia a planta e marca nela
 * onde acontece cada etapa de montagem ou de finalização; o Head marca as da
 * área dele. Quem é da equipe da etapa (ou o responsável) marca Iniciar e
 * Concluir. Todos do campo veem. A RLS (migration *_planta_evento) repete
 * cada regra no banco.
 */

export const MAX_PLAN_BYTES = MAX_PHOTO_BYTES;
/** Quem pode ser responsável por uma etapa. */
const FIELD_ROLES = ["GERENTE", "HEAD", "OPERACIONAL"] as const;

function requireField(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canUseField(actor, eventId)) throw new NotFoundError("Planta");
}

async function eventTimeZone(actor: Actor, eventId: string) {
  const e = await actor.run((tx) => tx.event.findUnique({ where: { id: eventId }, select: { timezone: true } }));
  return e?.timezone ?? DEFAULT_TZ;
}

// ───────────────────────────── Plantas ─────────────────────────────

const planSelect = { id: true, eventId: true, name: true, position: true, sha256: true, _count: { select: { points: true } } } as const;

/** Plantas do evento, na ordem. */
export async function listPlans(actor: Actor, eventId: string) {
  requireField(actor, eventId);
  const plans = await actor.run((tx) =>
    tx.floorPlan.findMany({ where: { eventId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: planSelect }),
  );
  return plans.map(({ _count, ...p }) => ({ ...p, points: _count.points }));
}

const planSchema = z.object({ name: text(80) });

function checkPlanImage(bytes: Uint8Array) {
  if (bytes.length === 0) throw new ValidationError("Arquivo vazio");
  if (bytes.length > MAX_PLAN_BYTES) throw new ValidationError("Planta maior que 10 MB");
  const image = sniffImage(bytes);
  // HEIC só abre no iPhone; o navegador converte PDF e fotos grandes antes de enviar.
  if (!image || image.mime === "image/heic") throw new ValidationError("Envie a planta em PDF, JPG, PNG ou WebP");
  return image;
}

/** Nova planta (só o gestor). O PDF chega aqui já convertido em imagem pelo navegador. */
export async function uploadPlan(actor: Actor, eventId: string, input: unknown, bytes: Uint8Array | null) {
  requireField(actor, eventId);
  if (!canManagePlans(actor, eventId)) throw new ForbiddenError("Só o gerente envia a planta");
  const data = parse(planSchema, input);
  if (!bytes) throw new ValidationError("Escolha o arquivo da planta");
  const image = checkPlanImage(bytes);
  const id = randomUUID();
  const storageKey = `events/${eventId}/plans/${id}.${image.ext}`;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const storage = getStorage();
  if (!storage.inDatabase) await storage.put(storageKey, bytes, image.mime);
  return actor.run(async (tx) => {
    if (storage.inDatabase) await storage.put(storageKey, bytes, image.mime, tx);
    const last = await tx.floorPlan.aggregate({ where: { eventId }, _max: { position: true } });
    const plan = await tx.floorPlan.create({
      data: {
        id, eventId, name: data.name, position: (last._max.position ?? -1) + 1,
        storageKey, mimeType: image.mime, sizeBytes: bytes.length, sha256, createdById: actor.userId,
      },
      select: { id: true, name: true },
    });
    await audit(tx, actor, { eventId, entity: "floor_plan", entityId: id, action: "CREATE", after: { name: data.name, sizeBytes: bytes.length } });
    return plan;
  });
}

async function loadPlan(actor: Actor, planId: string) {
  const plan = uuid.safeParse(planId).success ? await actor.run((tx) => tx.floorPlan.findUnique({ where: { id: planId } })) : null;
  if (!plan || !canUseField(actor, plan.eventId)) throw new NotFoundError("Planta");
  return plan;
}

async function loadManagedPlan(actor: Actor, planId: string) {
  const plan = await loadPlan(actor, planId);
  if (!canManagePlans(actor, plan.eventId)) throw new ForbiddenError("Só o gerente muda a planta");
  return plan;
}

/** Renomear a planta (só o gestor). */
export async function renamePlan(actor: Actor, planId: string, input: unknown) {
  const plan = await loadManagedPlan(actor, planId);
  const data = parse(planSchema, input);
  return actor.run(async (tx) => {
    const saved = await tx.floorPlan.update({ where: { id: plan.id }, data: { name: data.name }, select: { id: true, name: true } });
    await audit(tx, actor, { eventId: plan.eventId, entity: "floor_plan", entityId: plan.id, action: "UPDATE", ...diff({ name: plan.name }, { name: data.name }) });
    return saved;
  });
}

/** Apagar a planta e as etapas marcadas nela (só o gestor). */
export async function deletePlan(actor: Actor, planId: string) {
  const plan = await loadManagedPlan(actor, planId);
  return actor.run(async (tx) => {
    const points = await tx.planPoint.count({ where: { planId: plan.id } });
    await tx.floorPlan.delete({ where: { id: plan.id } });
    await audit(tx, actor, { eventId: plan.eventId, entity: "floor_plan", entityId: plan.id, action: "DELETE", before: { name: plan.name, points } });
    return { ok: true };
  });
}

/** Bytes (no banco/memória) ou link assinado (R2), depois de conferir o acesso. */
export async function planImage(actor: Actor, planId: string) {
  const plan = await loadPlan(actor, planId);
  return readFile(actor, plan.storageKey, plan.mimeType, "Planta");
}

async function readFile(actor: Actor, key: string, mimeType: string, what: string) {
  const storage = getStorage();
  if (storage.get) {
    const get = storage.get.bind(storage);
    const body = storage.inDatabase ? await actor.run((tx) => get(key, tx)) : await get(key);
    if (!body) throw new NotFoundError(what);
    return { body, mimeType, url: null };
  }
  return { body: null, mimeType, url: await storage.signedUrl(key) };
}

// ───────────────────────────── Quadro ─────────────────────────────

const pointSelect = {
  id: true, eventId: true, planId: true, x: true, y: true, name: true, description: true, kind: true,
  areaId: true, teamId: true, responsibleId: true, startsAt: true, endsAt: true,
  status: true, startedAt: true, finishedAt: true, note: true, createdAt: true,
  // Nomes que a pessoa não pode ver (outra área, outra equipe) voltam vazios pela RLS.
  area: { select: { name: true } },
  team: { select: { name: true } },
  responsible: { select: { name: true } },
  photos: { select: { id: true }, orderBy: { createdAt: "asc" as const } },
} as const;

/**
 * Tudo o que a tela da planta precisa: as plantas, a escolhida, as etapas
 * dela (com o que esta pessoa pode fazer em cada uma) e as opções dos
 * formulários para quem marca etapas.
 */
export async function getPlanBoard(actor: Actor, eventId: string, planId?: string | null) {
  requireField(actor, eventId);
  const plans = await listPlans(actor, eventId);
  const plan = plans.find((p) => p.id === planId) ?? plans[0] ?? null;
  const m = membershipFor(actor, eventId);
  const manager = canManagePlans(actor, eventId);
  // O Head marca etapas só na área dele; o gestor em qualquer uma.
  const editsArea = manager ? null : m?.role === "HEAD" ? m.areaId : undefined;
  const canMark = manager || (editsArea !== undefined && editsArea !== null);

  const [points, options] = await Promise.all([
    plan
      ? actor.run((tx) => tx.planPoint.findMany({ where: { eventId, planId: plan.id }, orderBy: [{ startsAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }], select: pointSelect }))
      : Promise.resolve([]),
    canMark ? pointOptions(actor, eventId, editsArea ?? null) : Promise.resolve(null),
  ]);

  return {
    plans,
    plan,
    canManagePlans: manager,
    canMark,
    /** Área que o Head pode usar (null = qualquer uma, para o gestor). */
    lockedAreaId: manager ? null : (editsArea ?? null),
    timeZone: await eventTimeZone(actor, eventId),
    options,
    points: points.map(({ area, team, responsible, photos, ...p }) => ({
      ...p,
      areaName: area?.name ?? null,
      teamName: team?.name ?? null,
      responsibleName: responsible?.name ?? null,
      photoIds: photos.map((f) => f.id),
      canEdit: canEditPlanPoint(actor, p),
      canWork: canWorkPlanPoint(actor, p),
    })),
  };
}

/** Áreas, equipes e pessoas para os formulários de etapa (só o que a pessoa vê e pode usar). */
async function pointOptions(actor: Actor, eventId: string, onlyArea: string | null) {
  return actor.run(async (tx) => {
    const areaWhere = { eventId, deletedAt: null, status: "ACTIVE" as const, ...(onlyArea ? { id: onlyArea } : {}) };
    const [areas, teams, people] = await Promise.all([
      tx.area.findMany({ where: areaWhere, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      tx.team.findMany({
        where: { eventId, deletedAt: null, status: "ACTIVE", ...(onlyArea ? { areaId: onlyArea } : {}) },
        orderBy: { name: "asc" },
        select: { id: true, name: true, areaId: true },
      }),
      tx.participant.findMany({
        where: { eventId, active: true, deletedAt: null, role: { in: [...FIELD_ROLES] }, ...(onlyArea ? { areaId: onlyArea } : {}) },
        orderBy: { name: "asc" },
        select: { id: true, name: true, role: true, areaId: true, teamId: true },
      }),
    ]);
    return { areas, teams, people };
  });
}

/** Para o painel do campo: quantas etapas concluídas e quais estão atrasadas. */
export async function plansSummary(actor: Actor, eventId: string, now = new Date()) {
  if (!canUseField(actor, eventId)) return null;
  const points = await actor.run((tx) =>
    tx.planPoint.findMany({
      where: { eventId },
      select: { id: true, planId: true, name: true, kind: true, status: true, startsAt: true, endsAt: true },
      orderBy: [{ endsAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    }),
  );
  if (points.length === 0) return null;
  const late = points.filter((p) => pointSituation(p, now) === "ATRASADO");
  return {
    total: points.length,
    done: points.filter((p) => p.status === "CONCLUIDO").length,
    doing: points.filter((p) => p.status === "EM_ANDAMENTO").length,
    late: late.length,
    lateRows: late.slice(0, 5),
  };
}

// ───────────────────────────── Etapas ─────────────────────────────

const coord = z.number({ message: "Toque na planta para marcar o lugar" }).min(0).max(100);

function pointSchema(timeZone: string) {
  const when = z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? null : (fromLocalInput(v, timeZone) ?? v)) : v),
    z.date({ message: "Data e hora inválidas" }).nullable(),
  );
  return z.object({
    name: text(120),
    description: optionalText(1000),
    kind: z.enum(["MONTAGEM", "FINALIZACAO"], { message: "Escolha montagem ou finalização" }),
    x: coord,
    y: coord,
    areaId: uuid.nullable().optional(),
    teamId: uuid.nullable().optional(),
    responsibleId: uuid.nullable().optional(),
    startsAt: when.optional(),
    endsAt: when.optional(),
  });
}

type PointInput = z.output<ReturnType<typeof pointSchema>>;
type PointFields = {
  areaId: string | null; teamId: string | null; responsibleId: string | null;
  startsAt: Date | null; endsAt: Date | null;
};

/**
 * Confere área, equipe e responsável contra o que a pessoa enxerga no evento
 * (RLS) e devolve os valores finais. A equipe define a área quando ela não vem.
 */
async function resolveScope(actor: Actor, eventId: string, f: PointFields) {
  let areaId = f.areaId;
  if (f.teamId) {
    const team = await actor.run((tx) => tx.team.findFirst({ where: { id: f.teamId!, eventId, deletedAt: null }, select: { areaId: true } }));
    if (!team) throw new ValidationError("Equipe não encontrada neste evento");
    if (areaId && areaId !== team.areaId) throw new ValidationError("A equipe não é dessa área");
    areaId = team.areaId;
  }
  if (areaId) {
    const area = await actor.run((tx) => tx.area.findFirst({ where: { id: areaId!, eventId, deletedAt: null }, select: { id: true } }));
    if (!area) throw new ValidationError("Área não encontrada neste evento");
  }
  if (f.responsibleId) {
    const p = await actor.run((tx) =>
      tx.participant.findFirst({
        where: { id: f.responsibleId!, eventId, active: true, deletedAt: null, role: { in: [...FIELD_ROLES] } },
        select: { id: true },
      }),
    );
    if (!p) throw new ValidationError("Escolha como responsável alguém do campo deste evento");
  }
  if (f.startsAt && f.endsAt && f.endsAt < f.startsAt) throw new ValidationError("O fim previsto é antes do início");
  if (!canEditPlanPoint(actor, { eventId, areaId })) {
    throw new ForbiddenError(membershipFor(actor, eventId)?.role === "HEAD" ? "Marque etapas só da sua área" : "Só o gerente ou o head da área marca etapas");
  }
  return { areaId, teamId: f.teamId, responsibleId: f.responsibleId };
}

/** Nova etapa marcada na planta (gestor, ou Head na área dele). */
export async function createPoint(actor: Actor, planId: string, input: unknown) {
  const plan = await loadPlan(actor, planId);
  const data: PointInput = parse(pointSchema(await eventTimeZone(actor, plan.eventId)), input);
  // O Head que não escolhe área marca na dele.
  const m = membershipFor(actor, plan.eventId);
  const fields: PointFields = {
    areaId: data.areaId ?? (m?.role === "HEAD" && !canManagePlans(actor, plan.eventId) && !data.teamId ? m.areaId : null),
    teamId: data.teamId ?? null,
    responsibleId: data.responsibleId ?? null,
    startsAt: data.startsAt ?? null,
    endsAt: data.endsAt ?? null,
  };
  const scope = await resolveScope(actor, plan.eventId, fields);
  return actor.run(async (tx) => {
    const p = await tx.planPoint.create({
      data: {
        eventId: plan.eventId, planId: plan.id, x: data.x, y: data.y, name: data.name, description: data.description,
        kind: data.kind, ...scope, startsAt: fields.startsAt, endsAt: fields.endsAt, createdById: actor.userId,
      },
      select: { id: true },
    });
    await audit(tx, actor, {
      eventId: plan.eventId, entity: "plan_point", entityId: p.id, action: "CREATE",
      after: { plan: plan.name, name: data.name, kind: data.kind, ...scope },
    });
    return p;
  });
}

async function loadPoint(actor: Actor, pointId: string) {
  const p = uuid.safeParse(pointId).success ? await actor.run((tx) => tx.planPoint.findUnique({ where: { id: pointId } })) : null;
  if (!p || !canUseField(actor, p.eventId)) throw new NotFoundError("Etapa");
  return p;
}

/** Corrigir a etapa ou mudar de lugar (gestor, ou Head da área dela). */
export async function updatePoint(actor: Actor, pointId: string, input: unknown) {
  const p = await loadPoint(actor, pointId);
  if (!canEditPlanPoint(actor, p)) throw new ForbiddenError("Só o gerente ou o head da área muda a etapa");
  const data = parse(pointSchema(await eventTimeZone(actor, p.eventId)).partial(), input);
  const pick = <K extends keyof PointFields>(k: K): PointFields[K] => (data[k] === undefined ? p[k] : data[k]) as PointFields[K];
  const fields: PointFields = {
    // Trocou a equipe sem dizer a área: a área sai da equipe.
    areaId: data.teamId !== undefined && data.areaId === undefined && data.teamId ? null : pick("areaId"),
    teamId: pick("teamId"),
    responsibleId: pick("responsibleId"),
    startsAt: pick("startsAt"),
    endsAt: pick("endsAt"),
  };
  // Tirou a área: a equipe (que é da área) sai junto.
  if (data.areaId === null && data.teamId === undefined) fields.teamId = null;
  const scope = await resolveScope(actor, p.eventId, fields);
  const next = {
    x: data.x ?? p.x, y: data.y ?? p.y, name: data.name ?? p.name,
    description: data.description === undefined ? p.description : data.description,
    kind: data.kind ?? p.kind, ...scope, startsAt: fields.startsAt, endsAt: fields.endsAt,
  };
  return actor.run(async (tx) => {
    await tx.planPoint.update({ where: { id: p.id }, data: next });
    const changes = diff(p as unknown as Record<string, unknown>, next);
    if (Object.keys(changes.after).length) {
      await audit(tx, actor, { eventId: p.eventId, entity: "plan_point", entityId: p.id, action: "UPDATE", ...changes });
    }
    return { id: p.id };
  });
}

/** Apagar a etapa (gestor, ou Head da área dela). */
export async function deletePoint(actor: Actor, pointId: string) {
  const p = await loadPoint(actor, pointId);
  if (!canEditPlanPoint(actor, p)) throw new ForbiddenError("Só o gerente ou o head da área apaga a etapa");
  return actor.run(async (tx) => {
    await tx.planPoint.delete({ where: { id: p.id } });
    await audit(tx, actor, { eventId: p.eventId, entity: "plan_point", entityId: p.id, action: "DELETE", before: { name: p.name, status: p.status } });
    return { ok: true };
  });
}

const statusSchema = z.object({
  status: z.enum(["NAO_INICIADO", "EM_ANDAMENTO", "CONCLUIDO"]),
  note: optionalText(1000),
});

/**
 * Iniciar, concluir ou desfazer. Pode quem é da equipe da etapa, o
 * responsável, o Head da área e o gestor. Fica no nome de quem fez.
 */
export async function setPointStatus(actor: Actor, pointId: string, input: unknown) {
  const p = await loadPoint(actor, pointId);
  if (!canWorkPlanPoint(actor, p)) throw new ForbiddenError("Só a equipe da etapa, o responsável, o head ou o gerente marcam");
  const data = parse(statusSchema, input);
  const now = new Date();
  const patch =
    data.status === "NAO_INICIADO"
      ? { status: data.status, startedAt: null, startedById: null, finishedAt: null, finishedById: null }
      : data.status === "EM_ANDAMENTO"
        ? {
            status: data.status,
            ...(p.startedAt ? {} : { startedAt: now, startedById: actor.userId }),
            finishedAt: null, finishedById: null,
          }
        : { status: data.status, finishedAt: now, finishedById: actor.userId };
  const note = data.note ?? (data.status === "NAO_INICIADO" ? null : p.note);
  return actor.run(async (tx) => {
    await tx.planPoint.update({ where: { id: p.id }, data: { ...patch, note } });
    await audit(tx, actor, {
      eventId: p.eventId, entity: "plan_point", entityId: p.id,
      action: data.status === "CONCLUIDO" ? "CONCLUDE" : "STATUS_CHANGE",
      before: { status: p.status }, after: { status: data.status, note },
    });
    return { id: p.id, status: data.status };
  });
}

/** Foto da etapa (ex.: a montagem pronta). Quem marca a etapa pode enviar. */
export async function addPointPhoto(actor: Actor, pointId: string, bytes: Uint8Array) {
  const p = await loadPoint(actor, pointId);
  if (!canWorkPlanPoint(actor, p)) throw new ForbiddenError("Só a equipe da etapa, o responsável, o head ou o gerente enviam foto");
  if (bytes.length === 0) throw new ValidationError("Arquivo vazio");
  if (bytes.length > MAX_PHOTO_BYTES) throw new ValidationError("Foto maior que 10 MB");
  const image = sniffImage(bytes);
  if (!image) throw new ValidationError("Envie uma foto (JPEG, PNG, WebP ou HEIC)");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const existing = await actor.run((tx) => tx.planPointPhoto.findUnique({ where: { pointId_sha256: { pointId: p.id, sha256 } } }));
  if (existing) return { id: existing.id };

  const photoId = randomUUID();
  const storageKey = `events/${p.eventId}/plan-points/${p.id}/${photoId}.${image.ext}`;
  const storage = getStorage();
  if (!storage.inDatabase) await storage.put(storageKey, bytes, image.mime);
  return actor.run(async (tx) => {
    if (storage.inDatabase) await storage.put(storageKey, bytes, image.mime, tx);
    await tx.planPointPhoto.create({
      data: { id: photoId, eventId: p.eventId, pointId: p.id, storageKey, mimeType: image.mime, sizeBytes: bytes.length, sha256, uploadedById: actor.userId },
    });
    await audit(tx, actor, { eventId: p.eventId, entity: "plan_point", entityId: p.id, action: "UPDATE", after: { photoAdded: photoId } });
    return { id: photoId };
  });
}

/** Abre a foto da etapa, depois de conferir o acesso. */
export async function pointPhoto(actor: Actor, photoId: string) {
  const f = uuid.safeParse(photoId).success ? await actor.run((tx) => tx.planPointPhoto.findUnique({ where: { id: photoId } })) : null;
  if (!f || !canUseField(actor, f.eventId)) throw new NotFoundError("Foto");
  return readFile(actor, f.storageKey, f.mimeType, "Foto");
}
