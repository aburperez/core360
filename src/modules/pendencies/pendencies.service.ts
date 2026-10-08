import { z } from "zod";
import type { Actor } from "../../server/authz/actor";
import { canUsePreProduction } from "../../server/authz/policy";
import { audit, diff } from "../../server/audit/audit";
import { NotFoundError, ValidationError } from "../../server/errors";
import type { Tx } from "../../server/db/with-user";
import { parse, text, uuid } from "../../lib/validation";
import { requireEventAccess } from "../events/events.service";
import { ITEM_STATUS_LABEL, itemCode, type ItemCategory } from "../items/item-meta";
import { itemReady } from "../schedule/schedule.service";
import { daysBetween, todayIn } from "../schedule/schedule-meta";
import { isSupplierDirector } from "../suppliers/supplier-meta";
import { RATING_OPEN_STATUSES } from "../suppliers/rating-meta";
import { pendencyGroup, type PendencyGroup, type PendencyKind } from "./pendency-meta";

/**
 * Central de pendências (fase 4B): numa lista só, o que falta fazer no
 * evento. O app junta os marcos não feitos, os itens com prazo que não estão
 * prontos, as cotações e contratos em aberto, os fornecedores sem avaliação
 * no Fechamento (só o diretor avalia) e as pendências criadas à mão. Só a
 * Pré-produção vê; a RLS da migration *_pendencias repete a regra.
 */

function requirePre(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canUsePreProduction(actor, eventId)) throw new NotFoundError("Pré-produção");
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: string, n: number) => iso(new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000));

type Ref = { id: string; name: string } | null;
export type Pendency = {
  key: string;
  kind: PendencyKind;
  id: string;
  title: string;
  detail: string | null;
  dueOn: string | null;
  group: PendencyGroup;
  /** Dias de atraso (só no Atrasado). */
  lateDays: number;
  area: Ref;
  responsible: Ref;
  /** Onde resolver; vazio nas que se marcam aqui mesmo. */
  href: string | null;
  /** Marco e pendência manual: o botão de feito fica na lista. */
  toggle: boolean;
};

// Filtro inválido (endereço mexido) vale como sem filtro.
const filterSchema = z.object({ areaId: uuid.optional().catch(undefined), responsibleId: uuid.optional().catch(undefined) });

/** Pessoas que podem ser responsáveis: as ativas do evento, sem o cliente. */
const people = (tx: Tx, eventId: string) =>
  tx.participant.findMany({
    where: { eventId, active: true, deletedAt: null, role: { not: "CLIENTE" } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

export async function listPendencies(actor: Actor, eventId: string, filters: unknown = {}, now = new Date()) {
  requirePre(actor, eventId);
  const f = parse(filterSchema, filters);
  const director = isSupplierDirector(actor, eventId);
  const base = `/eventos/${eventId}/pre-producao`;
  return actor.run(async (tx) => {
    const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { name: true, number: true, timezone: true, status: true } });
    const today = todayIn(event.timezone, now);
    const weekEnd = addDays(today, 7);
    const ratingOpen = (RATING_OPEN_STATUSES as readonly string[]).includes(event.status);
    const [milestones, items, quotes, contracts, tasks, areas, team, signed, rated] = await Promise.all([
      tx.eventMilestone.findMany({
        where: { eventId, doneAt: null },
        select: { id: true, title: true, dueOn: true, responsible: { select: { id: true, name: true } } },
      }),
      tx.costItem.findMany({
        where: { eventId, neededOn: { not: null } },
        select: {
          id: true, name: true, number: true, category: true, status: true, neededOn: true,
          area: { select: { id: true, name: true } }, responsible: { select: { id: true, name: true } },
          dependsOn: { select: { name: true, status: true } },
        },
      }),
      tx.quoteRequest.findMany({
        where: { eventId, status: { in: ["ABERTA", "ENVIADA"] } },
        select: {
          id: true, title: true, status: true, dueAt: true, completedAt: true,
          responsible: { select: { id: true, name: true } },
          costItem: { select: { neededOn: true, area: { select: { id: true, name: true } } } },
          quotes: { where: { status: { not: "CANCELADA" }, totalValue: { not: null } }, select: { id: true } },
        },
      }),
      tx.contract.findMany({
        where: { eventId, status: { in: ["RASCUNHO", "ENVIADO"] } },
        select: {
          id: true, number: true, status: true, supplier: { select: { companyName: true, tradeName: true } },
          items: { select: { quote: { select: { request: { select: { costItem: { select: { neededOn: true, area: { select: { id: true, name: true } } } } } } } } } },
        },
      }),
      tx.eventTask.findMany({
        where: { eventId, doneAt: null },
        select: { id: true, title: true, dueOn: true, area: { select: { id: true, name: true } }, responsible: { select: { id: true, name: true } } },
      }),
      tx.area.findMany({ where: { eventId, deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      people(tx, eventId),
      // Avaliação: só o diretor avalia, e só no Fechamento.
      director && ratingOpen
        ? tx.contract.findMany({ where: { eventId, status: "ASSINADO" }, select: { supplierId: true, supplier: { select: { companyName: true, tradeName: true } } } })
        : Promise.resolve([]),
      director && ratingOpen ? tx.supplierRating.findMany({ where: { eventId }, select: { supplierId: true } }) : Promise.resolve([]),
    ]);

    const all: Pendency[] = [];
    let later = 0;
    const push = (p: Omit<Pendency, "key" | "group" | "lateDays">, lateNow = false) => {
      const g = pendencyGroup(p.dueOn, today, weekEnd, lateNow);
      if (g === "DEPOIS") {
        later++;
        return;
      }
      all.push({ ...p, key: `${p.kind}:${p.id}`, group: g, lateDays: g === "ATRASADO" && p.dueOn ? Math.max(0, daysBetween(p.dueOn, today)) : 0 });
    };

    for (const m of milestones) {
      push({ kind: "MARCO", id: m.id, title: m.title, detail: "Marco do cronograma", dueOn: iso(m.dueOn), area: null, responsible: m.responsible, href: null, toggle: true });
    }
    for (const i of items) {
      if (itemReady(i.status)) continue;
      const code = itemCode(event.number, i.category as ItemCategory | null, i.number);
      const waiting = i.dependsOn && !itemReady(i.dependsOn.status) ? ` · aguardando ${i.dependsOn.name}` : "";
      push({
        kind: "ITEM", id: i.id, title: `${i.name} pronto`, detail: `${code} · ${ITEM_STATUS_LABEL[i.status]}${waiting}`,
        dueOn: iso(i.neededOn!), area: i.area, responsible: i.responsible, href: `${base}/itens/${i.id}`, toggle: false,
      });
    }
    for (const q of quotes) {
      // Esperando os fornecedores: vale o prazo da cotação. Para enviar ou escolher: a data do item.
      const waiting = q.status === "ENVIADA" && !q.completedAt;
      const due = waiting && q.dueAt ? todayIn(event.timezone, q.dueAt) : q.costItem?.neededOn ? iso(q.costItem.neededOn) : null;
      const received = q.quotes.length;
      const [title, detail] =
        q.status === "ABERTA" ? [`Enviar a cotação "${q.title}"`, "Ainda não foi para os fornecedores"]
        : q.completedAt ? [`Escolher o orçamento de "${q.title}"`, `${received} orçamentos recebidos`]
        : [`Receber os orçamentos de "${q.title}"`, `${received} de 3 recebidos${q.dueAt ? "" : " · sem prazo definido"}`];
      push(
        { kind: "COTACAO", id: q.id, title, detail, dueOn: due, area: q.costItem?.area ?? null, responsible: q.responsible, href: `${base}/cotacoes/${q.id}`, toggle: false },
        // O prazo da cotação tem hora: passou da hora, já está atrasada.
        waiting && !!q.dueAt && q.dueAt < now,
      );
    }
    for (const c of contracts) {
      const linked = c.items.map((i) => i.quote.request.costItem).filter((x) => x !== null);
      const dates = linked.flatMap((x) => (x.neededOn ? [iso(x.neededOn)] : [])).sort();
      const name = c.supplier.tradeName || c.supplier.companyName;
      push({
        kind: "CONTRATO", id: c.id,
        title: c.status === "RASCUNHO" ? `Enviar o contrato nº ${c.number} (${name})` : `Assinar o contrato nº ${c.number} (${name})`,
        detail: dates.length ? "Prazo: o primeiro item que ele contrata" : c.status === "RASCUNHO" ? "Rascunho" : "Enviado ao fornecedor",
        dueOn: dates[0] ?? null, area: linked.find((x) => x.area)?.area ?? null, responsible: null, href: `${base}/contratos/${c.id}`, toggle: false,
      });
    }
    const ratedIds = new Set(rated.map((r) => r.supplierId));
    const seen = new Set<string>();
    for (const s of signed) {
      if (ratedIds.has(s.supplierId) || seen.has(s.supplierId)) continue;
      seen.add(s.supplierId);
      push({
        kind: "AVALIACAO", id: s.supplierId, title: `Avaliar ${s.supplier.tradeName || s.supplier.companyName}`, detail: "Fornecedor com contrato assinado",
        dueOn: null, area: null, responsible: null, href: `${base}/avaliacao`, toggle: false,
      });
    }
    for (const t of tasks) {
      push({ kind: "MANUAL", id: t.id, title: t.title, detail: null, dueOn: t.dueOn ? iso(t.dueOn) : null, area: t.area, responsible: t.responsible, href: null, toggle: true });
    }

    // Mais atrasado primeiro; no mesmo dia, pela ordem dos tipos.
    const order: PendencyKind[] = ["MARCO", "ITEM", "COTACAO", "CONTRATO", "AVALIACAO", "MANUAL"];
    all.sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") || order.indexOf(a.kind) - order.indexOf(b.kind) || a.title.localeCompare(b.title, "pt-BR"));
    const shown = all.filter((p) => (!f.areaId || p.area?.id === f.areaId) && (!f.responsibleId || p.responsible?.id === f.responsibleId));
    const count = (g: PendencyGroup, list = all) => list.filter((p) => p.group === g).length;
    return {
      eventName: event.name,
      today,
      filters: f,
      items: shown,
      /** Contagens do evento todo (sem filtro). */
      totals: { late: count("ATRASADO"), today: count("HOJE"), week: count("SEMANA"), undated: count("SEM_DATA"), later },
      areas,
      people: team,
    };
  });
}

/** Para o painel da Pré-produção: quantas estão atrasadas, vencem hoje e na semana. */
export async function pendenciesSummary(actor: Actor, eventId: string, now = new Date()) {
  const { totals } = await listPendencies(actor, eventId, {}, now);
  return totals;
}

// ───────────────────────── Pendências manuais ─────────────────────────

const day = z.iso.date({ message: "Data inválida" });
const taskSchema = z.object({
  title: text(160),
  dueOn: day.nullable().optional(),
  areaId: uuid.nullable().optional(),
  responsibleId: uuid.nullable().optional(),
});

async function checkRefs(tx: Tx, eventId: string, data: { areaId?: string | null; responsibleId?: string | null }) {
  if (data.areaId && !(await tx.area.findFirst({ where: { id: data.areaId, eventId, deletedAt: null }, select: { id: true } }))) {
    throw new ValidationError("Escolha uma área do evento", { areaId: ["Escolha uma área do evento"] });
  }
  if (data.responsibleId && !(await people(tx, eventId)).some((p) => p.id === data.responsibleId)) {
    throw new ValidationError("Escolha alguém do evento", { responsibleId: ["Escolha alguém do evento"] });
  }
}

const toDate = (d: string | null | undefined) => (d ? new Date(`${d}T00:00:00.000Z`) : null);
const auditable = (t: { title: string; dueOn: Date | null; areaId: string | null; responsibleId: string | null }) =>
  ({ title: t.title, dueOn: t.dueOn ? iso(t.dueOn) : null, areaId: t.areaId, responsibleId: t.responsibleId });

async function loadTask(actor: Actor, tx: Tx, id: string) {
  const t = uuid.safeParse(id).success ? await tx.eventTask.findUnique({ where: { id } }) : null;
  if (!t || !canUsePreProduction(actor, t.eventId)) throw new NotFoundError("Pendência");
  return t;
}

export async function getTask(actor: Actor, id: string) {
  return actor.run(async (tx) => {
    const t = await loadTask(actor, tx, id);
    return { id: t.id, title: t.title, dueOn: t.dueOn ? iso(t.dueOn) : null, areaId: t.areaId, responsibleId: t.responsibleId, done: !!t.doneAt };
  });
}

/** Nova pendência, criada à mão. */
export async function createTask(actor: Actor, eventId: string, input: unknown) {
  requirePre(actor, eventId);
  const data = parse(taskSchema, input);
  return actor.run(async (tx) => {
    await checkRefs(tx, eventId, data);
    const t = await tx.eventTask.create({
      data: { eventId, title: data.title, dueOn: toDate(data.dueOn), areaId: data.areaId ?? null, responsibleId: data.responsibleId ?? null, createdById: actor.userId },
    });
    await audit(tx, actor, { eventId, entity: "event_task", entityId: t.id, action: "CREATE", after: auditable(t) });
    return { id: t.id };
  });
}

export async function updateTask(actor: Actor, id: string, input: unknown) {
  const data = parse(taskSchema.partial(), input);
  return actor.run(async (tx) => {
    const t = await loadTask(actor, tx, id);
    await checkRefs(tx, t.eventId, data);
    const updated = await tx.eventTask.update({
      where: { id: t.id },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...("dueOn" in data && { dueOn: toDate(data.dueOn) }),
        ...("areaId" in data && { areaId: data.areaId ?? null }),
        ...("responsibleId" in data && { responsibleId: data.responsibleId ?? null }),
      },
    });
    await audit(tx, actor, { eventId: t.eventId, entity: "event_task", entityId: t.id, action: "UPDATE", ...diff(auditable(t), auditable(updated)) });
    return { id: t.id };
  });
}

/** Feita (no nome de quem marcou) ou não. */
export async function setTaskDone(actor: Actor, id: string, input: unknown) {
  const { done } = parse(z.object({ done: z.boolean() }), input);
  return actor.run(async (tx) => {
    const t = await loadTask(actor, tx, id);
    if (!!t.doneAt === done) return { id: t.id, done };
    await tx.eventTask.update({ where: { id: t.id }, data: done ? { doneAt: new Date(), doneById: actor.userId } : { doneAt: null, doneById: null } });
    await audit(tx, actor, { eventId: t.eventId, entity: "event_task", entityId: t.id, action: "STATUS_CHANGE", before: { done: !done }, after: { done, title: t.title } });
    return { id: t.id, done };
  });
}

export async function deleteTask(actor: Actor, id: string) {
  return actor.run(async (tx) => {
    const t = await loadTask(actor, tx, id);
    await tx.eventTask.delete({ where: { id: t.id } });
    await audit(tx, actor, { eventId: t.eventId, entity: "event_task", entityId: t.id, action: "DELETE", before: auditable(t) });
    return { ok: true };
  });
}
