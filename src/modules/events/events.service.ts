import { z } from "zod";
import type { Actor, EventRole } from "../../server/authz/actor";
import { isAgencyAdmin, isEventAdmin, membershipFor } from "../../server/authz/actor";
import { canReviewSla, canSeeEvent, canUsePreProduction } from "../../server/authz/policy";
import { audit, diff } from "../../server/audit/audit";
import { ForbiddenError, NotFoundError, ValidationError } from "../../server/errors";
import { optionalText, parse, text, uuid } from "../../lib/validation";
import { DEFAULT_SLA_MINUTES } from "../occurrences/sla";
import { DEFAULT_TZ, fromLocalInput } from "../../lib/tz";
import { EVENT_STATUSES } from "../../lib/event-stages";
import { parseDecimal } from "../../lib/money";

/** Garante que o evento existe E está no escopo do usuário; senão, 404. */
export function requireEventAccess(actor: Actor, eventId: string): void {
  if (!uuid.safeParse(eventId).success || !canSeeEvent(actor, eventId)) {
    throw new NotFoundError("Evento");
  }
}

function myRole(actor: Actor, eventId: string): EventRole | "ADMIN" | null {
  return isEventAdmin(actor, eventId) ? "ADMIN" : (membershipFor(actor, eventId)?.role ?? null);
}

export async function listEvents(actor: Actor) {
  const events = await actor.run((tx) =>
    tx.event.findMany({
      where: { deletedAt: null },
      orderBy: { startsAt: "asc" },
      include: { client: { select: { id: true, name: true } } },
    }),
  );
  return events.map((e) => ({ ...e, myRole: myRole(actor, e.id) }));
}

export async function getEvent(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  const event = await actor.run((tx) =>
    tx.event.findFirst({
      where: { id: eventId, deletedAt: null },
      include: {
        client: { select: { id: true, name: true } },
        lead: { select: { id: true, name: true } },
        producer: { select: { id: true, name: true } },
      },
    }),
  );
  if (!event) throw new NotFoundError("Evento");
  const managers = await actor.run((tx) =>
    tx.participant.findMany({
      where: { eventId, role: "GERENTE", active: true, deletedAt: null },
      select: { id: true, name: true, phone: true, email: true },
    }),
  );
  return { ...event, managers, myRole: myRole(actor, eventId) };
}

/**
 * Data e hora: instante ISO, ou "2027-04-10T12:00" (campo da tela, sem fuso),
 * que vale no fuso do evento.
 */
const when = (timeZone = DEFAULT_TZ) =>
  z.preprocess(
    (v) => (typeof v === "string" ? (fromLocalInput(v, timeZone) ?? v) : v),
    z.coerce.date({ message: "Data inválida" }),
  );

const createEventSchema = z
  .object({
    clientId: uuid,
    name: text(),
    description: optionalText(),
    startsAt: when(),
    endsAt: when(),
    venue: optionalText(200),
    address: optionalText(300),
  })
  .refine((v) => v.endsAt >= v.startsAt, { message: "Fim antes do início", path: ["endsAt"] });

/**
 * Só o Admin da agência cria eventos, para clientes da própria agência. O
 * evento herda a agência do cliente. Já cria as políticas de SLA.
 */
export async function createEvent(actor: Actor, input: unknown) {
  if (!isAgencyAdmin(actor)) throw new ForbiddenError();
  const data = parse(createEventSchema, input);
  return actor.run(async (tx) => {
    const client = await tx.client.findFirst({ where: { id: data.clientId, deletedAt: null }, select: { agencyId: true, status: true } });
    if (!client || !isAgencyAdmin(actor, client.agencyId)) throw new NotFoundError("Cliente");
    if (client.status !== "ACTIVE") throw new ValidationError("Este cliente está desativado");
    const event = await tx.event.create({ data: { ...data, agencyId: client.agencyId } });
    await tx.slaPolicy.createMany({
      data: Object.entries(DEFAULT_SLA_MINUTES).map(([priority, targetMinutes]) => ({
        eventId: event.id,
        priority: priority as keyof typeof DEFAULT_SLA_MINUTES,
        targetMinutes,
      })),
    });
    await audit(tx, actor, { eventId: event.id, entity: "event", entityId: event.id, action: "CREATE", after: data });
    return event;
  });
}

/** Texto opcional que, vazio, vira null; ausente fica como está. */
const optional = <T extends z.ZodType>(schema: T) => z.union([z.literal("").transform(() => null), z.null(), schema]).optional();

const updateEventSchema = z.object({
  name: text().optional(),
  description: optionalText(),
  startsAt: z.string().or(z.date()).optional(),
  endsAt: z.string().or(z.date()).optional(),
  venue: optionalText(200),
  address: optionalText(300),
  status: z.enum(EVENT_STATUSES).optional(),
  project: optionalText(200),
  eventType: optionalText(100),
  city: optionalText(100),
  state: optional(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "UF com 2 letras")),
  setupStartsAt: optional(z.string().or(z.date())),
  setupEndsAt: optional(z.string().or(z.date())),
  teardownStartsAt: optional(z.string().or(z.date())),
  teardownEndsAt: optional(z.string().or(z.date())),
  expectedAudience: optional(z.coerce.number({ message: "Número inválido" }).int("Número inteiro").min(0).max(10_000_000)),
  leadId: optional(uuid),
  producerId: optional(uuid),
  notes: optionalText(4000),
  // Valores: só a Pré-produção vê; grava o gestor (event_finances).
  approvedBudget: optional(z.string().or(z.number())),
  costCenter: optionalText(100),
});

const PERIODS = [["setupStartsAt", "setupEndsAt", "Montagem"], ["teardownStartsAt", "teardownEndsAt", "Desmontagem"]] as const;
const DATE_KEYS = ["startsAt", "endsAt", "setupStartsAt", "setupEndsAt", "teardownStartsAt", "teardownEndsAt"] as const;
const FINANCE_KEYS = ["approvedBudget", "costCenter"] as const;

function budget(v: string | number | null | undefined): number | null | undefined {
  if (v === undefined || v === null) return v;
  const n = typeof v === "number" ? v : parseDecimal(v);
  if (n === null || n < 0 || n > 999_999_999_999) throw new ValidationError("Orçamento aprovado inválido", { approvedBudget: ["Valor inválido"] });
  return Math.round(n * 100) / 100;
}

/** Valores da ficha (orçamento aprovado e centro de custo): só a Pré-produção e o Admin. */
export async function getEventFinances(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canUsePreProduction(actor, eventId)) return null;
  const f = await actor.run((tx) => tx.eventFinances.findUnique({ where: { eventId } }));
  return { approvedBudget: f?.approvedBudget == null ? null : Number(f.approvedBudget), costCenter: f?.costCenter ?? null };
}

/** Quem pode ser responsável geral ou produtor: Gerente ou Pré-produtor ativo do evento. */
export async function eventLeaders(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  return actor.run((tx) =>
    tx.participant.findMany({
      where: { eventId, active: true, deletedAt: null, role: { in: ["GERENTE", "PRE_PRODUTOR"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true },
    }),
  );
}

/** Ficha e etapa do evento: o Admin da agência ou o Gerente do evento. */
export async function updateEvent(actor: Actor, eventId: string, input: unknown) {
  requireEventAccess(actor, eventId);
  if (!isEventAdmin(actor, eventId) && membershipFor(actor, eventId)?.role !== "GERENTE") throw new ForbiddenError();
  const parsed = parse(updateEventSchema, input);
  // Campo que não veio fica como está (os opcionais de texto viram null sem isso).
  const raw = (input ?? {}) as Record<string, unknown>;
  const sent = Object.fromEntries(Object.entries(parsed).filter(([k]) => k in raw)) as Partial<typeof parsed>;
  const { approvedBudget, costCenter, ...fields } = sent;
  const finances = FINANCE_KEYS.some((k) => k in sent);
  if (finances && !canReviewSla(actor, eventId)) throw new ForbiddenError();
  return actor.run(async (tx) => {
    const found = await tx.event.findFirst({
      where: { id: eventId, deletedAt: null },
      select: {
        name: true, description: true, startsAt: true, endsAt: true, venue: true, address: true, status: true, timezone: true,
        project: true, eventType: true, city: true, state: true, setupStartsAt: true, setupEndsAt: true, teardownStartsAt: true,
        teardownEndsAt: true, expectedAudience: true, leadId: true, producerId: true, notes: true,
      },
    });
    if (!found) throw new NotFoundError("Evento");
    const { timezone, ...before } = found;
    const data: Record<string, unknown> = { ...fields };
    for (const k of DATE_KEYS) {
      const v = fields[k];
      if (v !== undefined) data[k] = v === null ? null : parse(when(timezone), v);
    }
    if (data.startsAt === null || data.endsAt === null) throw new ValidationError("Início e fim do evento são obrigatórios");
    const after = { ...before, ...data } as typeof before;
    if (after.endsAt < after.startsAt) throw new ValidationError("O fim não pode ser antes do início");
    for (const [from, to, label] of PERIODS) {
      if (after[from] && after[to] && after[to] < after[from]) throw new ValidationError(`${label}: o fim não pode ser antes do início`);
    }
    for (const k of ["leadId", "producerId"] as const) {
      const id = fields[k];
      if (!id || id === before[k]) continue;
      const ok = await tx.participant.findFirst({
        where: { id, eventId, active: true, deletedAt: null, role: { in: ["GERENTE", "PRE_PRODUTOR"] } },
        select: { id: true },
      });
      if (!ok) throw new ValidationError("O responsável geral e o produtor precisam ser Gerente ou Pré-produtor do evento");
    }
    const changes = diff(before, data as Partial<typeof before>);
    if (Object.keys(changes.after).length) {
      await tx.event.update({ where: { id: eventId }, data });
      await audit(tx, actor, { eventId, entity: "event", entityId: eventId, action: "UPDATE", ...changes });
    }
    if (finances) {
      const prev = await tx.eventFinances.findUnique({ where: { eventId } });
      const old = { approvedBudget: prev?.approvedBudget == null ? null : Number(prev.approvedBudget), costCenter: prev?.costCenter ?? null };
      const next = {
        ...("approvedBudget" in sent ? { approvedBudget: budget(approvedBudget) ?? null } : {}),
        ...("costCenter" in sent ? { costCenter: costCenter ?? null } : {}),
      };
      const money = diff(old, next);
      if (Object.keys(money.after).length) {
        await tx.eventFinances.upsert({
          where: { eventId },
          create: { eventId, ...old, ...next, updatedById: actor.userId },
          update: { ...next, updatedById: actor.userId },
        });
        await audit(tx, actor, { eventId, entity: "event_finances", entityId: eventId, action: "UPDATE", ...money });
      }
    }
    return { id: eventId };
  });
}
