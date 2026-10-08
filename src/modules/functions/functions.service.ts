import { z } from "zod";
import type { Actor } from "../../server/authz/actor";
import type { Tx } from "../../server/db/with-user";
import { canGiveFunction, canGiveFunctions, canReviewSla, canUseField, canUsePreProduction } from "../../server/authz/policy";
import { membershipFor } from "../../server/authz/actor";
import { audit, diff } from "../../server/audit/audit";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../server/errors";
import { isUniqueViolation } from "../../server/db/errors";
import { optionalText, parse, text, uuid } from "../../lib/validation";
import { requireEventAccess } from "../events/events.service";
import { briefingState } from "../briefings/briefings.service";

/**
 * Painel de funções (Pré-produção › Funções): a Pré-produção cria as funções
 * do evento uma vez, com as atividades (dia e horário), e dá a função a cada
 * pessoa do campo. A pessoa vê a função e a agenda em "Meu briefing", marca
 * o que já fez e preenche a própria ficha. Quem decide o acesso é o banco
 * (migration 20261007010000_funcoes); aqui só se organiza.
 */

/** Funções com que todo evento pode começar (lista da produção, outubro de 2026). */
export const DEFAULT_FUNCTIONS = [
  "A&B", "Almoxarifado / Inventário", "Apoio", "Arquiteto", "Atendimento", "Artístico",
  "Assistente Executivo", "Brindes", "Caex / Credenciamento / CAM", "Comunicação Visual", "Criativo",
  "Executivo", "Infra", "Logística", "Operação", "Runner", "Técnica", "Serviços",
] as const;

const DEFAULT_SET = new Set<string>(DEFAULT_FUNCTIONS.map((n) => n.toLowerCase()));

/** Função fora da lista padrão: só o diretor de produção cria ou renomeia (a RLS confere de novo). */
export function isDefaultFunctionName(name: string) {
  return DEFAULT_SET.has(name.trim().toLowerCase());
}

function requireCustomFunction(actor: Actor, eventId: string, name: string | undefined) {
  if (name !== undefined && !isDefaultFunctionName(name) && !canReviewSla(actor, eventId)) {
    throw new ForbiddenError("Só o diretor de produção cria funções fora da lista. Escolha uma da lista ou peça para ele.");
  }
}

const FIELD_ROLES = ["GERENTE", "HEAD", "OPERACIONAL"] as const;
const PROFILE_FIELDS = ["document", "uniformSize", "dietary", "emergencyName", "emergencyPhone"] as const;

function requirePre(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canUsePreProduction(actor, eventId)) throw new NotFoundError("Pré-produção");
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "pt-BR");

// ───────────────────────────── Atividades ─────────────────────────────

const time = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM")
  .optional()
  .nullable()
  .or(z.literal("").transform(() => null))
  .transform((v) => v || null);

const activitySchema = z
  .object({
    title: text(200),
    day: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida")
      .optional()
      .nullable()
      .or(z.literal("").transform(() => null))
      .transform((v) => v || null),
    startTime: time,
    endTime: time,
    place: optionalText(200),
  })
  .refine((a) => !a.endTime || a.startTime, { message: "Informe o início", path: ["startTime"] })
  .refine((a) => !a.endTime || !a.startTime || a.endTime >= a.startTime, { message: "Fim antes do início", path: ["endTime"] });

type ActivityInput = z.output<typeof activitySchema>;

const toDate = (day: string | null) => (day ? new Date(`${day}T00:00:00.000Z`) : null);
const fromDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const activitySelect = {
  id: true, title: true, day: true, startTime: true, endTime: true, place: true, functionId: true, participantId: true,
} as const;

type ActivityRow = {
  id: string; title: string; day: Date | null; startTime: string | null; endTime: string | null; place: string | null;
  functionId: string | null; participantId: string | null;
};

/** Agenda: por dia e hora; sem dia ou sem hora vai para o fim. */
export function sortActivities<T extends { day: string | null; startTime: string | null; title: string }>(list: T[]) {
  return [...list].sort(
    (a, b) =>
      (a.day ?? "9999").localeCompare(b.day ?? "9999") ||
      (a.startTime ?? "99").localeCompare(b.startTime ?? "99") ||
      a.title.localeCompare(b.title, "pt-BR"),
  );
}

function activityView(a: ActivityRow) {
  return { ...a, day: fromDate(a.day), own: !!a.participantId };
}

function activityData(a: ActivityInput) {
  return { title: a.title, day: toDate(a.day), startTime: a.startTime, endTime: a.endTime, place: a.place };
}

// ───────────────────────────── Painel ─────────────────────────────

/** Pré-produção › Funções: as funções e todas as pessoas do campo, numa tela. */
export async function getFunctionsPanel(actor: Actor, eventId: string) {
  requirePre(actor, eventId);
  return actor.run(async (tx) => {
    const [functions, people, activities, checks] = await Promise.all([
      tx.eventFunction.findMany({
        where: { eventId },
        select: { id: true, name: true, description: true, _count: { select: { activities: true, profiles: true } } },
      }),
      tx.participant.findMany({
        where: { eventId, active: true, deletedAt: null, role: { in: [...FIELD_ROLES] } },
        orderBy: [{ area: { name: "asc" } }, { team: { name: "asc" } }, { name: "asc" }],
        select: {
          id: true, name: true, role: true, jobTitle: true, phone: true, email: true,
          area: { select: { id: true, name: true } },
          team: { select: { id: true, name: true } },
          profile: { select: { functionId: true, document: true, uniformSize: true, dietary: true, emergencyName: true, emergencyPhone: true } },
          briefing: { select: { version: true, readVersion: true } },
        },
      }),
      tx.activity.findMany({ where: { eventId }, select: { id: true, functionId: true, participantId: true } }),
      tx.activityCheck.findMany({ where: { eventId }, select: { activityId: true, participantId: true } }),
    ]);

    const byFunction = new Map<string, string[]>();
    const byPerson = new Map<string, string[]>();
    for (const a of activities) {
      const [map, key] = a.functionId ? [byFunction, a.functionId] : [byPerson, a.participantId!];
      map.set(key, [...(map.get(key) ?? []), a.id]);
    }
    const done = new Set(checks.map((c) => `${c.activityId}:${c.participantId}`));

    return {
      functions: functions
        .map((f) => ({ id: f.id, name: f.name, description: f.description, activityCount: f._count.activities, peopleCount: f._count.profiles }))
        .sort(byName),
      people: people.map(({ profile, briefing, ...p }) => {
        const mine = [...(profile?.functionId ? (byFunction.get(profile.functionId) ?? []) : []), ...(byPerson.get(p.id) ?? [])];
        return {
          ...p,
          functionId: profile?.functionId ?? null,
          profileFilled: PROFILE_FIELDS.filter((k) => profile?.[k]).length,
          activities: { total: mine.length, done: mine.filter((id) => done.has(`${id}:${p.id}`)).length },
          briefingState: briefingState(briefing),
        };
      }),
      defaults: DEFAULT_FUNCTIONS.filter((n) => !functions.some((f) => f.name.toLowerCase() === n.toLowerCase())),
    };
  });
}

// ───────────────────────────── Funções ─────────────────────────────

const functionSchema = z.object({ name: text(80), description: optionalText(2000) });

function conflictOnName(e: unknown): never {
  if (isUniqueViolation(e)) throw new ConflictError("Já existe uma função com este nome");
  throw e;
}

export async function createFunction(actor: Actor, eventId: string, input: unknown) {
  requirePre(actor, eventId);
  const data = parse(functionSchema, input);
  requireCustomFunction(actor, eventId, data.name);
  try {
    return await actor.run(async (tx) => {
      const f = await tx.eventFunction.create({ data: { ...data, eventId, createdById: actor.userId }, select: { id: true, name: true } });
      await audit(tx, actor, { eventId, entity: "event_function", entityId: f.id, action: "CREATE", after: data });
      return f;
    });
  } catch (e) {
    conflictOnName(e);
  }
}

const defaultsSchema = z.object({
  /** Quais da lista padrão (click and build). Sem isso, todas as que faltam. */
  names: z.array(text(80)).max(100).optional(),
});

/** Cria de uma vez as funções escolhidas da lista padrão que o evento ainda não tem. */
export async function createDefaultFunctions(actor: Actor, eventId: string, input: unknown = {}) {
  requirePre(actor, eventId);
  const picked = parse(defaultsSchema, input).names?.map((n) => n.trim().toLowerCase());
  if (picked?.some((n) => !DEFAULT_SET.has(n))) throw new ValidationError("Escolha funções da lista padrão");
  return actor.run(async (tx) => {
    const existing = await tx.eventFunction.findMany({ where: { eventId }, select: { name: true } });
    const have = new Set(existing.map((f) => f.name.toLowerCase()));
    const names = DEFAULT_FUNCTIONS.filter((n) => !have.has(n.toLowerCase()) && (!picked || picked.includes(n.toLowerCase())));
    if (names.length) {
      await tx.eventFunction.createMany({ data: names.map((name) => ({ eventId, name, createdById: actor.userId })) });
      await audit(tx, actor, { eventId, entity: "event_function", action: "CREATE", after: { defaults: names } });
    }
    return { count: names.length };
  });
}

async function loadFunction(actor: Actor, functionId: string) {
  const f = uuid.safeParse(functionId).success
    ? await actor.run((tx) => tx.eventFunction.findUnique({ where: { id: functionId }, select: { id: true, eventId: true, name: true, description: true } }))
    : null;
  if (!f || !canUsePreProduction(actor, f.eventId)) throw new NotFoundError("Função");
  return f;
}

/** Uma função: descrição, atividades e quem tem ela (com as outras pessoas para aplicar). */
export async function getFunction(actor: Actor, functionId: string) {
  const f = await loadFunction(actor, functionId);
  return actor.run(async (tx) => {
    const [activities, people] = await Promise.all([
      tx.activity.findMany({ where: { eventId: f.eventId, functionId: f.id }, select: activitySelect }),
      tx.participant.findMany({
        where: { eventId: f.eventId, active: true, deletedAt: null, role: { in: [...FIELD_ROLES] } },
        orderBy: [{ area: { name: "asc" } }, { team: { name: "asc" } }, { name: "asc" }],
        select: {
          id: true, name: true, role: true, jobTitle: true,
          area: { select: { name: true } }, team: { select: { id: true, name: true } },
          profile: { select: { function: { select: { id: true, name: true } } } },
        },
      }),
    ]);
    return {
      ...f,
      activities: sortActivities(activities.map(activityView)),
      people: people.map(({ profile, ...p }) => ({ ...p, function: profile?.function ?? null })),
    };
  });
}

export async function updateFunction(actor: Actor, functionId: string, input: unknown) {
  const f = await loadFunction(actor, functionId);
  const data = parse(functionSchema.partial(), input);
  if (data.name !== undefined && data.name !== f.name) requireCustomFunction(actor, f.eventId, data.name);
  try {
    return await actor.run(async (tx) => {
      const saved = await tx.eventFunction.update({ where: { id: f.id }, data, select: { id: true, name: true, description: true } });
      const changes = diff({ name: f.name, description: f.description }, data);
      if (Object.keys(changes.after).length) {
        await audit(tx, actor, { eventId: f.eventId, entity: "event_function", entityId: f.id, action: "UPDATE", ...changes });
      }
      return saved;
    });
  } catch (e) {
    conflictOnName(e);
  }
}

/** Apaga a função e as atividades dela; quem tinha fica sem função. */
export async function deleteFunction(actor: Actor, functionId: string) {
  const f = await loadFunction(actor, functionId);
  return actor.run(async (tx) => {
    const { count } = await tx.participantProfile.updateMany({ where: { eventId: f.eventId, functionId: f.id }, data: { functionId: null } });
    await tx.eventFunction.delete({ where: { id: f.id } });
    await audit(tx, actor, { eventId: f.eventId, entity: "event_function", entityId: f.id, action: "DELETE", before: { name: f.name, people: count } });
    return { ok: true };
  });
}

async function fieldPeople(tx: Tx, eventId: string, ids: string[]) {
  const found = await tx.participant.findMany({
    where: { eventId, id: { in: ids }, active: true, deletedAt: null, role: { in: [...FIELD_ROLES] } },
    select: { id: true },
  });
  if (found.length !== new Set(ids).size) throw new ValidationError("Escolha pessoas do campo deste evento");
  return found.map((p) => p.id);
}

/** Grava a função pelo banco (app.give_function), que confere de novo quem pode dar. Devolve a anterior. */
export async function setFunction(tx: Tx, eventId: string, participantId: string, functionId: string | null) {
  const [row] = await tx.$queryRaw<{ before: string | null }[]>`
    SELECT app.give_function(${eventId}::uuid, ${participantId}::uuid, ${functionId}::uuid) AS before`;
  return row?.before ?? null;
}

/** Quem tem esta função: os marcados ficam com ela; os desmarcados ficam sem função. */
export async function setFunctionPeople(actor: Actor, functionId: string, input: unknown) {
  const f = await loadFunction(actor, functionId);
  const { participantIds } = parse(z.object({ participantIds: z.array(uuid).max(2000) }), input);
  return actor.run(async (tx) => {
    const ids = await fieldPeople(tx, f.eventId, participantIds);
    const had = await tx.participantProfile.findMany({ where: { eventId: f.eventId, functionId: f.id }, select: { participantId: true } });
    const removed = had.map((p) => p.participantId).filter((id) => !ids.includes(id));
    const added = ids.filter((id) => !had.some((p) => p.participantId === id));
    if (removed.length) {
      await tx.participantProfile.updateMany({ where: { eventId: f.eventId, participantId: { in: removed } }, data: { functionId: null } });
    }
    for (const id of added) await setFunction(tx, f.eventId, id, f.id);
    if (added.length || removed.length) {
      await audit(tx, actor, { eventId: f.eventId, entity: "event_function", entityId: f.id, action: "REASSIGN", after: { added, removed } });
    }
    return { count: ids.length };
  });
}

/**
 * Troca a função de uma pessoa (ou tira, com null). A Pré-produção dá a
 * qualquer pessoa do campo; o Head, aos Operacionais da área dele.
 */
export async function setPersonFunction(actor: Actor, eventId: string, participantId: string, input: unknown) {
  requireEventAccess(actor, eventId);
  if (!canGiveFunctions(actor, eventId)) throw new NotFoundError("Pessoa");
  const { functionId } = parse(z.object({ functionId: uuid.nullable() }), input);
  if (!uuid.safeParse(participantId).success) throw new NotFoundError("Pessoa");
  return actor.run(async (tx) => {
    const p = await tx.participant.findFirst({
      where: { id: participantId, eventId, deletedAt: null },
      select: { role: true, areaId: true, active: true },
    });
    if (!p) throw new NotFoundError("Pessoa");
    if (!p.active || !(FIELD_ROLES as readonly string[]).includes(p.role)) throw new ValidationError("Escolha pessoas do campo deste evento");
    if (!canGiveFunction(actor, eventId, p)) throw new ForbiddenError("O Head dá função só aos Operacionais da área dele");
    if (functionId && !(await tx.eventFunction.findFirst({ where: { id: functionId, eventId }, select: { id: true } }))) {
      throw new NotFoundError("Função");
    }
    const before = await setFunction(tx, eventId, participantId, functionId);
    if (before !== functionId) {
      await audit(tx, actor, {
        eventId, entity: "participant_profile", entityId: participantId, action: "ROLE_CHANGE",
        before: { functionId: before }, after: { functionId },
      });
    }
    return { functionId };
  });
}

/**
 * Para a tela Montar equipe: as funções do evento e a função de cada pessoa a
 * quem eu posso dar função (sem o resto da ficha). null = não dou função aqui.
 */
export async function listFunctionChoices(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canGiveFunctions(actor, eventId)) return null;
  return actor.run(async (tx) => {
    const [functions, rows] = await Promise.all([
      tx.eventFunction.findMany({ where: { eventId }, select: { id: true, name: true } }),
      tx.$queryRaw<{ participant_id: string; function_id: string }[]>`
        SELECT participant_id, function_id FROM app.function_assignments(${eventId}::uuid)`,
    ]);
    return {
      functions: functions.sort(byName),
      assigned: Object.fromEntries(rows.map((r) => [r.participant_id, r.function_id])) as Record<string, string>,
    };
  });
}

// ──────────────────────── Atividades (Pré-produção) ────────────────────────

export async function addFunctionActivity(actor: Actor, functionId: string, input: unknown) {
  const f = await loadFunction(actor, functionId);
  const data = parse(activitySchema, input);
  return actor.run(async (tx) => {
    const a = await tx.activity.create({
      data: { ...activityData(data), eventId: f.eventId, functionId: f.id, createdById: actor.userId },
      select: activitySelect,
    });
    await audit(tx, actor, { eventId: f.eventId, entity: "activity", entityId: a.id, action: "CREATE", after: { functionId: f.id, title: a.title } });
    return activityView(a);
  });
}

export async function addPersonActivity(actor: Actor, eventId: string, participantId: string, input: unknown) {
  requirePre(actor, eventId);
  const data = parse(activitySchema, input);
  if (!uuid.safeParse(participantId).success) throw new NotFoundError("Pessoa");
  return actor.run(async (tx) => {
    await fieldPeople(tx, eventId, [participantId]);
    const a = await tx.activity.create({
      data: { ...activityData(data), eventId, participantId, createdById: actor.userId },
      select: activitySelect,
    });
    await audit(tx, actor, { eventId, entity: "activity", entityId: a.id, action: "CREATE", after: { participantId, title: a.title } });
    return activityView(a);
  });
}

async function loadActivity(actor: Actor, activityId: string) {
  const a = uuid.safeParse(activityId).success
    ? await actor.run((tx) => tx.activity.findUnique({ where: { id: activityId }, select: { ...activitySelect, eventId: true } }))
    : null;
  if (!a || !canUsePreProduction(actor, a.eventId)) throw new NotFoundError("Atividade");
  return a;
}

export async function updateActivity(actor: Actor, activityId: string, input: unknown) {
  const a = await loadActivity(actor, activityId);
  const data = parse(activitySchema, input);
  return actor.run(async (tx) => {
    const saved = await tx.activity.update({ where: { id: a.id }, data: activityData(data), select: activitySelect });
    const changes = diff(activityView(a) as Record<string, unknown>, { ...data });
    if (Object.keys(changes.after).length) {
      await audit(tx, actor, { eventId: a.eventId, entity: "activity", entityId: a.id, action: "UPDATE", ...changes });
    }
    return activityView(saved);
  });
}

export async function deleteActivity(actor: Actor, activityId: string) {
  const a = await loadActivity(actor, activityId);
  return actor.run(async (tx) => {
    await tx.activity.delete({ where: { id: a.id } });
    await audit(tx, actor, { eventId: a.eventId, entity: "activity", entityId: a.id, action: "DELETE", before: { title: a.title } });
    return { ok: true };
  });
}

// ───────────────────────────── Ficha ─────────────────────────────

const profileSchema = z.object({
  document: optionalText(30),
  uniformSize: optionalText(10),
  dietary: optionalText(200),
  emergencyName: optionalText(120),
  emergencyPhone: optionalText(30),
});

/** Agenda de uma pessoa: as atividades da função dela e as só dela, com o "feito". */
async function planOf(tx: Tx, eventId: string, participantId: string, functionId: string | null) {
  const [activities, checks] = await Promise.all([
    tx.activity.findMany({
      where: { eventId, OR: [{ participantId }, ...(functionId ? [{ functionId }] : [])] },
      select: activitySelect,
    }),
    tx.activityCheck.findMany({ where: { eventId, participantId }, select: { activityId: true, doneAt: true } }),
  ]);
  const done = new Map(checks.map((c) => [c.activityId, c.doneAt]));
  return sortActivities(activities.map((a) => ({ ...activityView(a), doneAt: done.get(a.id) ?? null })));
}

const profileSelect = {
  functionId: true, document: true, uniformSize: true, dietary: true, emergencyName: true, emergencyPhone: true, updatedAt: true,
  function: { select: { id: true, name: true, description: true } },
} as const;

/** Pré-produção: uma pessoa, com dados, função, ficha e agenda. */
export async function getPersonPlan(actor: Actor, eventId: string, participantId: string) {
  requirePre(actor, eventId);
  if (!uuid.safeParse(participantId).success) throw new NotFoundError("Pessoa");
  return actor.run(async (tx) => {
    const person = await tx.participant.findFirst({
      where: { id: participantId, eventId, active: true, deletedAt: null, role: { in: [...FIELD_ROLES] } },
      select: {
        id: true, name: true, email: true, phone: true, role: true, jobTitle: true,
        area: { select: { name: true } }, team: { select: { name: true } },
        profile: { select: profileSelect },
      },
    });
    if (!person) throw new NotFoundError("Pessoa");
    const { profile, ...p } = person;
    const functions = await tx.eventFunction.findMany({ where: { eventId }, select: { id: true, name: true } });
    return {
      person: p,
      profile,
      activities: await planOf(tx, eventId, p.id, profile?.functionId ?? null),
      functions: functions.sort(byName),
    };
  });
}

async function saveProfile(tx: Tx, actor: Actor, eventId: string, participantId: string, data: z.output<typeof profileSchema>) {
  const before = await tx.participantProfile.findUnique({ where: { participantId }, select: { ...profileSelect, function: false } });
  await tx.participantProfile.upsert({
    where: { participantId },
    create: { ...data, eventId, participantId, updatedById: actor.userId },
    update: data,
  });
  // No histórico ficam só os nomes dos campos: documento e contatos não vão para o log.
  const changed = PROFILE_FIELDS.filter((k) => (before?.[k] ?? null) !== data[k]);
  if (changed.length) {
    await audit(tx, actor, { eventId, entity: "participant_profile", entityId: participantId, action: before ? "UPDATE" : "CREATE", after: { fields: changed } });
  }
}

export async function savePersonProfile(actor: Actor, eventId: string, participantId: string, input: unknown) {
  requirePre(actor, eventId);
  const data = parse(profileSchema, input);
  if (!uuid.safeParse(participantId).success) throw new NotFoundError("Pessoa");
  return actor.run(async (tx) => {
    await fieldPeople(tx, eventId, [participantId]);
    await saveProfile(tx, actor, eventId, participantId, data);
    return { ok: true };
  });
}

// ───────────────────────────── No campo ─────────────────────────────

function me(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canUseField(actor, eventId)) throw new NotFoundError("Briefing");
  const m = membershipFor(actor, eventId);
  return m && (FIELD_ROLES as readonly string[]).includes(m.role) ? m.participantId : null;
}

/** "Meu briefing": minha função, minha agenda e minha ficha. */
export async function getMyPlan(actor: Actor, eventId: string) {
  const participantId = me(actor, eventId);
  if (!participantId) return null;
  return actor.run(async (tx) => {
    const profile = await tx.participantProfile.findUnique({ where: { participantId }, select: profileSelect });
    return {
      function: profile?.function ?? null,
      profile,
      activities: await planOf(tx, eventId, participantId, profile?.functionId ?? null),
    };
  });
}

/** Tem função ou atividade? (para mostrar "Meu briefing" no menu e na tela inicial) */
export async function myPlanSummary(actor: Actor, eventId: string) {
  if (!canUseField(actor, eventId)) return { has: false, pending: 0 };
  const participantId = membershipFor(actor, eventId)?.participantId;
  if (!participantId) return { has: false, pending: 0 };
  return actor.run(async (tx) => {
    const profile = await tx.participantProfile.findUnique({ where: { participantId }, select: { functionId: true } });
    const ids = await tx.activity.findMany({
      where: { eventId, OR: [{ participantId }, ...(profile?.functionId ? [{ functionId: profile.functionId }] : [])] },
      select: { id: true },
    });
    const done = ids.length
      ? await tx.activityCheck.count({ where: { eventId, participantId, activityId: { in: ids.map((a) => a.id) } } })
      : 0;
    return { has: !!profile?.functionId || ids.length > 0, pending: Math.max(0, ids.length - done) };
  });
}

export async function saveMyProfile(actor: Actor, eventId: string, input: unknown) {
  const participantId = me(actor, eventId);
  if (!participantId) throw new NotFoundError("Ficha");
  const data = parse(profileSchema, input);
  return actor.run(async (tx) => {
    await saveProfile(tx, actor, eventId, participantId, data);
    return { ok: true };
  });
}

/** Marca ou desmarca "feito" numa atividade minha. */
export async function setActivityDone(actor: Actor, eventId: string, activityId: string, input: unknown) {
  const participantId = me(actor, eventId);
  const { done } = parse(z.object({ done: z.boolean() }), input);
  if (!participantId || !uuid.safeParse(activityId).success) throw new NotFoundError("Atividade");
  return actor.run(async (tx) => {
    const plan = await planOf(tx, eventId, participantId, (await tx.participantProfile.findUnique({ where: { participantId }, select: { functionId: true } }))?.functionId ?? null);
    if (!plan.some((a) => a.id === activityId)) throw new NotFoundError("Atividade");
    if (done) {
      await tx.activityCheck.upsert({
        where: { activityId_participantId: { activityId, participantId } },
        create: { activityId, participantId, eventId },
        update: {},
      });
    } else {
      await tx.activityCheck.deleteMany({ where: { activityId, participantId } });
    }
    return { done };
  });
}
