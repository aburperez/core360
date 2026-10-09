import type { Actor } from "../../server/authz/actor";
import { canReviewSla, canUseField, canUsePreProduction } from "../../server/authz/policy";
import { NotFoundError } from "../../server/errors";
import { requireEventAccess } from "../events/events.service";
import { pendenciesSummary, listPendencies } from "../pendencies/pendencies.service";
import { arrivalsSummary } from "../arrivals/arrivals.service";
import { occurrenceScope } from "../occurrences/occurrences.service";
import { getBudget } from "../items/budget.service";
import { getSchedule } from "../schedule/schedule.service";
import { quotesSummary } from "../quotes/quotes.service";
import { ITEM_STATUSES, type ItemStatus } from "../items/item-meta";

/**
 * Painéis da fase 6A: as prioridades de hoje em Meus eventos, as etapas dos
 * itens no painel do produtor e o painel executivo (só o diretor). Tudo sai
 * da mesma base; cada número passa pelo serviço que já confere quem vê o quê.
 */

// ─────────────────────── Meus eventos: prioridades de hoje ───────────────────────

/** Eventos que ainda pedem atenção (concluído e cancelado ficam de fora). */
const OPEN_EVENT = (s: string) => s !== "CONCLUIDO" && s !== "CANCELADO";

export type Priority = { tone: "red" | "amber"; text: string; href: string };

/**
 * Para cada evento aberto, o que está atrasado ou vence hoje, no escopo da
 * pessoa: pendências (Pré-produção), chamados urgentes e com prazo estourado
 * (campo) e as chegadas do mapa de montagem. Sem valores.
 */
export async function homePriorities(actor: Actor, events: { id: string; status: string }[], now = new Date()) {
  const open = events.filter((e) => OPEN_EVENT(e.status)).slice(0, 30);
  const rows = await Promise.all(open.map(async (e) => ({ eventId: e.id, items: await eventPriorities(actor, e.id, now) })));
  return new Map(rows.map((r) => [r.eventId, r.items]));
}

async function eventPriorities(actor: Actor, eventId: string, now: Date): Promise<Priority[]> {
  const base = `/eventos/${eventId}`;
  const pre = canUsePreProduction(actor, eventId);
  const field = canUseField(actor, eventId);
  const [pending, arrivals, tickets] = await Promise.all([
    pre ? pendenciesSummary(actor, eventId, now) : null,
    field ? arrivalsSummary(actor, eventId, now) : null,
    field ? ticketCounts(actor, eventId, now) : null,
  ]);
  const out: Priority[] = [];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (pending?.late) out.push({ tone: "red", text: plural(pending.late, "pendência atrasada", "pendências atrasadas"), href: `${base}/pre-producao/pendencias` });
  if (tickets?.urgent) out.push({ tone: "red", text: plural(tickets.urgent, "chamado urgente", "chamados urgentes"), href: `${base}/ocorrencias?status=URGENTE` });
  if (tickets?.breached) out.push({ tone: "red", text: plural(tickets.breached, "chamado fora do prazo", "chamados fora do prazo"), href: `${base}/ocorrencias` });
  if (arrivals?.late) out.push({ tone: "red", text: plural(arrivals.late, "chegada atrasada", "chegadas atrasadas"), href: `${base}/montagem` });
  if (pending?.today) out.push({ tone: "amber", text: plural(pending.today, "pendência vence hoje", "pendências vencem hoje"), href: `${base}/pre-producao/pendencias` });
  const waiting = arrivals?.todayWaiting ?? 0;
  if (waiting > 0) out.push({ tone: "amber", text: plural(waiting, "chegada prevista hoje", "chegadas previstas hoje"), href: `${base}/montagem` });
  return out;
}

const OPEN_TICKET = ["PENDENTE", "EM_ANDAMENTO", "URGENTE", "BLOQUEIO"] as const;

async function ticketCounts(actor: Actor, eventId: string, now: Date) {
  const scope = occurrenceScope(actor, eventId);
  return actor.run(async (tx) => {
    const [urgent, breached] = await Promise.all([
      tx.occurrence.count({ where: { AND: [scope, { status: { in: ["URGENTE", "BLOQUEIO"] } }] } }),
      tx.occurrence.count({ where: { AND: [scope, { status: { in: [...OPEN_TICKET] } }, { slaDueAt: { lt: now } }] } }),
    ]);
    return { urgent, breached };
  });
}

// ─────────────────────── Painel do produtor: itens por etapa ───────────────────────

/** As 13 etapas do item em 8 grupos, na ordem do fluxo. */
export const ITEM_STAGE_GROUPS: { key: string; label: string; statuses: ItemStatus[] }[] = [
  { key: "definir", label: "A definir", statuses: ["A_DEFINIR"] },
  { key: "cotacao", label: "Em cotação", statuses: ["EM_COTACAO", "COTACAO_RECEBIDA", "EM_APROVACAO"] },
  { key: "contratado", label: "Aprovado ou contratado", statuses: ["APROVADO", "CONTRATADO"] },
  { key: "producao", label: "Em produção ou transporte", statuses: ["EM_PRODUCAO", "PRONTO", "EM_TRANSPORTE"] },
  { key: "local", label: "No local", statuses: ["NO_LOCAL"] },
  { key: "montado", label: "Montado", statuses: ["MONTADO"] },
  { key: "conferido", label: "Conferido", statuses: ["CONFERIDO"] },
  { key: "finalizado", label: "Finalizado", statuses: ["FINALIZADO"] },
];

export function itemStages(statuses: ItemStatus[]) {
  const total = statuses.length;
  const groups = ITEM_STAGE_GROUPS.map((g) => ({ key: g.key, label: g.label, count: statuses.filter((s) => g.statuses.includes(s)).length }));
  // Pronto para o evento: chegou ao local (ou foi além).
  const atVenue = statuses.filter((s) => ITEM_STATUSES.indexOf(s) >= ITEM_STATUSES.indexOf("NO_LOCAL")).length;
  return { total, groups, atVenue };
}

// ─────────────────────── Painel executivo (só o diretor) ───────────────────────

/**
 * Os 4 valores do evento, economia e estouro por categoria, o orçamento
 * aprovado e os maiores riscos. Só o diretor de produção (Gerente ou Admin
 * do evento): é quem vê e define contratado e realizado.
 */
export async function getExecutivePanel(actor: Actor, eventId: string, now = new Date()) {
  requireEventAccess(actor, eventId);
  if (!canUsePreProduction(actor, eventId) || !canReviewSla(actor, eventId)) throw new NotFoundError("Painel executivo");
  const [budget, pend, schedule, quotes, contracts] = await Promise.all([
    getBudget(actor, eventId),
    listPendencies(actor, eventId, {}, now),
    getSchedule(actor, eventId, now),
    quotesSummary(actor, eventId, now),
    actor.run((tx) => tx.contract.count({ where: { eventId, status: { in: ["RASCUNHO", "ENVIADO"] } } })),
  ]);
  const base = `/eventos/${eventId}/pre-producao`;
  const late = pend.items.filter((p) => p.group === "ATRASADO");
  const risks: { tone: "red" | "amber"; text: string; href: string }[] = [];
  const add = (n: number, tone: "red" | "amber", one: string, many: string, href: string) => {
    if (n > 0) risks.push({ tone, text: `${n} ${n === 1 ? one : many}`, href });
  };
  add(late.filter((p) => p.kind === "MONTAGEM").length, "red", "item com montagem atrasada", "itens com montagem atrasada", `${base}/montagem`);
  add(late.filter((p) => p.kind === "ITEM").length, "red", "item atrasado para ficar pronto", "itens atrasados para ficar prontos", `${base}/cronograma`);
  add(quotes.late, "red", "cotação atrasada", "cotações atrasadas", `${base}/cotacoes`);
  add(late.filter((p) => p.kind === "MARCO").length, "red", "marco do cronograma atrasado", "marcos do cronograma atrasados", `${base}/cronograma`);
  add(contracts, "amber", "contrato sem assinatura", "contratos sem assinatura", `${base}/contratos`);
  add(quotes.toDecide, "amber", "cotação esperando sua escolha", "cotações esperando sua escolha", `${base}/cotacoes`);
  add(budget.items.filter((i) => !i.optional && i.contracted === null && i.status !== "A_DEFINIR" && i.estimated !== null).length, "amber",
    "item ainda sem valor contratado", "itens ainda sem valor contratado", `${base}/orcamento`);

  // Os maiores estouros (realizado acima do contratado) e as contratações acima do estimado.
  const overruns = budget.items
    .filter((i) => !i.optional && (i.overrun ?? 0) > 0)
    .sort((a, b) => b.overrun! - a.overrun!)
    .slice(0, 5)
    .map((i) => ({ id: i.id, code: i.code, name: i.name, value: i.overrun! }));
  const aboveEstimate = budget.items
    .filter((i) => !i.optional && (i.saving ?? 0) < 0)
    .sort((a, b) => a.saving! - b.saving!)
    .slice(0, 5)
    .map((i) => ({ id: i.id, code: i.code, name: i.name, value: -i.saving! }));

  return {
    totals: budget.totals,
    approved: budget.approved,
    byCategory: budget.byCategory,
    risks,
    overruns,
    aboveEstimate,
    schedule: { ...schedule.progress, late: schedule.late },
    pendencies: pend.totals,
  };
}
