import type { Actor } from "../../server/authz/actor";
import { canReviewSla, canUsePreProduction } from "../../server/authz/policy";
import { NotFoundError } from "../../server/errors";
import { ROLE_LABEL, STATUS_LABEL, formatPeriod } from "../../lib/format";
import { EVENT_STATUS_LABEL } from "../../lib/event-stages";
import { BRIEFING_BLOCKS } from "../../lib/event-briefing";
import { requireEventAccess, getEvent } from "../events/events.service";
import { getEventBriefing } from "../events/briefing.service";
import { listItemMap } from "../items/items.service";
import { getBudget } from "../items/budget.service";
import { CATEGORY, COST_CENTER_LABEL, ITEM_STATUS_LABEL, type ItemCategory } from "../items/item-meta";
import { getSchedule } from "../schedule/schedule.service";
import { listArrivals } from "../arrivals/arrivals.service";
import { ARRIVAL_STATUS } from "../arrivals/arrival-meta";
import { listPendencies } from "../pendencies/pendencies.service";
import { GROUPS, KIND_LABEL } from "../pendencies/pendency-meta";
import { listQuotes, type QuoteStage } from "../quotes/quotes.service";
import { listContracts } from "../contracts/contracts.service";
import { listEventRatings } from "../suppliers/ratings.service";
import { isSupplierDirector } from "../suppliers/supplier-meta";
import { getFunctionsPanel } from "../functions/functions.service";
import { getExecutivePanel } from "../panels/panels.service";
import { REPORTS, type Block, type Cell, type Column, type Report, type ReportKey } from "./catalog";

/**
 * Relatórios da fase 6B. Cada um é montado com os serviços que as telas já
 * usam, então quem vê o quê continua igual: só a Pré-produção abre, e
 * valores em dinheiro só saem para o diretor de produção (o financeiro e o
 * executivo inteiros são só dele). O campo nunca recebe valores.
 */

/** Diretor de produção do evento: Gerente ou Admin (o mesmo do painel executivo). */
const isDirector = (actor: Actor, eventId: string) => canReviewSla(actor, eventId);

export function canOpenReport(actor: Actor, eventId: string, key: ReportKey) {
  if (!canUsePreProduction(actor, eventId)) return false;
  return !REPORTS[key].director || isDirector(actor, eventId);
}

export async function buildReport(actor: Actor, eventId: string, key: ReportKey, now = new Date()): Promise<Report> {
  requireEventAccess(actor, eventId);
  if (!canOpenReport(actor, eventId, key)) throw new NotFoundError("Relatório");
  const event = await getEvent(actor, eventId);
  const tz = event.timezone;
  const ctx: Ctx = { actor, eventId, now, tz, director: isDirector(actor, eventId) };
  const blocks = await BUILDERS[key](ctx);
  const at = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: tz }).format(now);
  return {
    key,
    title: REPORTS[key].title,
    eventName: event.name,
    generated: `Gerado em ${at} por ${actor.name}`,
    values: blocks.some((b) => b.kind === "table" && b.columns.some((c) => c.money)),
    blocks,
  };
}

type Ctx = { actor: Actor; eventId: string; now: Date; tz: string; director: boolean };

// ───────────────────────────── formatos ─────────────────────────────

/** Data sem hora ("2027-04-10") como 10/04/2027. */
const day = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "");
const dateTime = (d: Date | null, tz: string) =>
  d ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: tz }).format(d) : "";
const time = (d: Date | null, tz: string) => (d ? new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(d) : "");
const category = (c: ItemCategory | null) => (c ? CATEGORY[c].label : "Sem categoria");
const col = (header: string, width: number, extra: Partial<Column> = {}): Column => ({ header, width, ...extra });
const money = (header: string, width = 15) => col(header, width, { money: true });
const table = (title: string, columns: Column[], rows: Cell[][], empty: string, note?: string): Block => ({ kind: "table", title, columns, rows, empty, ...(note && { note }) });

const QUOTE_STAGE: Record<QuoteStage, string> = {
  RASCUNHO: "Ainda não enviada", SEM_PRAZO: "Aguardando prazo do gestor", NO_PRAZO: "Recebendo orçamentos",
  ATRASADA: "Prazo vencido", DECIDIR: "Pronta para escolher", FECHADA: "Fechada", CANCELADA: "Cancelada",
};
const CONTRACT_STATUS: Record<string, string> = { RASCUNHO: "Rascunho", ENVIADO: "Enviado", ASSINADO: "Assinado", CANCELADO: "Cancelado" };

// ───────────────────────────── blocos ─────────────────────────────

async function fichaBlock({ actor, eventId }: Ctx): Promise<Block> {
  const e = await getEvent(actor, eventId);
  const cityUf = [e.city, e.state].filter(Boolean).join("/");
  const place = [e.venue, e.address, e.address?.includes(e.city ?? "\u0000") ? null : cityUf].filter(Boolean).join(" · ");
  return {
    kind: "facts",
    title: "Ficha do evento",
    rows: [
      ["Evento", e.name],
      ["Cliente", e.client.name],
      ["Etapa", EVENT_STATUS_LABEL[e.status] ?? e.status],
      ["Tipo", e.eventType ?? "—"],
      ["Datas", formatPeriod(e.startsAt, e.endsAt, e.timezone, true)],
      ["Montagem", e.setupStartsAt ? formatPeriod(e.setupStartsAt, e.setupEndsAt, e.timezone, true) : "—"],
      ["Desmontagem", e.teardownStartsAt ? formatPeriod(e.teardownStartsAt, e.teardownEndsAt, e.timezone, true) : "—"],
      ["Público estimado", e.expectedAudience != null ? `${e.expectedAudience.toLocaleString("pt-BR")} pessoas` : "—"],
      ["Local", place || "—"],
      ["Responsável", e.lead?.name ?? "—"],
      ["Produtor", e.producer?.name ?? "—"],
      ["Gerentes", e.managers.map((m) => m.name).join(", ") || "—"],
    ],
  };
}

async function briefingBlocks({ actor, eventId }: Ctx): Promise<Block[]> {
  const b = await getEventBriefing(actor, eventId);
  const text = b as unknown as Record<string, string | null>;
  const texts: [string, string][] = BRIEFING_BLOCKS.flatMap((blk) => blk.fields.filter((f) => text[f.key]).map((f): [string, string] => [f.label, text[f.key]!]));
  const fronts = b.fronts.filter((f) => f.needed !== false);
  return [
    { kind: "text", title: "Briefing do evento", rows: texts.length ? texts : [["Briefing", "Ainda não preenchido"]] },
    table("Estrutura (frentes do briefing)", [col("Frente", 26), col("Precisa", 12), col("Observações", 60)],
      fronts.map((f) => [f.label, f.needed ? "Precisa" : "A definir", f.notes ?? ""]), "Nenhuma frente marcada."),
  ];
}

async function scheduleBlock({ actor, eventId, now }: Ctx): Promise<Block> {
  const s = await getSchedule(actor, eventId, now);
  const STATE: Record<string, string> = { FEITO: "Feito", ATRASADO: "Atrasado", HOJE: "Vence hoje", PROXIMO: "No prazo" };
  return table(
    `Cronograma (${s.progress.done} de ${s.progress.total} marcos feitos)`,
    [col("Data", 12), col("T", 8), col("Marco", 40), col("Responsável", 22), col("Situação", 12)],
    s.milestones.map((m) => [day(m.dueOn), m.t, m.title, m.responsible ?? "", STATE[m.state] ?? m.state]),
    "Nenhum marco no cronograma.",
  );
}

async function itemsBlock(ctx: Ctx, withValues: boolean): Promise<Block[]> {
  const map = await listItemMap(ctx.actor, ctx.eventId);
  const budget = withValues ? await getBudget(ctx.actor, ctx.eventId) : null;
  const values = new Map(budget?.items.map((i) => [i.id, i]) ?? []);
  const columns = [
    col("Código", 16), col("Item", 34), col("Seção", 20), col("Categoria", 18), col("Área", 16),
    col("Qtd.", 8, { number: true }), col("Unid.", 8), col("Status", 15), col("Fornecedor", 24), col("Responsável", 20), col("Prazo", 11), col("Local", 18),
    ...(withValues ? [money("Estimado"), money("Cotado"), money("Contratado"), money("Realizado")] : []),
  ];
  const rows = map.items.map((i) => {
    const v = values.get(i.id);
    return [
      i.code, i.name, i.sectionName, category(i.category), i.areaName ?? "", i.quantity, i.unit ?? "", ITEM_STATUS_LABEL[i.status],
      i.supplier ?? "", i.responsibleName ?? "", day(i.neededOn), i.location ?? "",
      ...(withValues ? [v?.estimated ?? null, v?.quoted ?? null, v?.contracted ?? null, v?.actual ?? null] : []),
    ];
  });
  const byStatus = Object.entries(map.byStatus).map(([s, n]): [string, string] => [ITEM_STATUS_LABEL[s as keyof typeof ITEM_STATUS_LABEL], String(n)]);
  return [
    { kind: "facts", title: `Itens por status (${map.total} itens)`, rows: byStatus.length ? byStatus : [["Itens", "Nenhum item ainda"]] },
    table("Itens do evento", columns, rows, "Nenhum item no evento."),
  ];
}

async function suppliersBlocks(ctx: Ctx, withValues: boolean, withQuotes: boolean): Promise<Block[]> {
  const { actor, eventId, now } = ctx;
  const [closed, contracts, quotes, ratings] = await Promise.all([
    actor.run((tx) =>
      tx.quoteRequest.findMany({
        where: { eventId, status: "FECHADA", chosenQuoteId: { not: null } },
        orderBy: { closedAt: "asc" },
        select: {
          title: true,
          costItem: { select: { name: true } },
          chosen: { select: { supplierId: true, companyName: true, contactName: true, phone: true, email: true } },
        },
      }),
    ),
    actor.run((tx) =>
      tx.contract.findMany({
        where: { eventId, status: { not: "CANCELADO" } },
        orderBy: { number: "asc" },
        select: {
          number: true, status: true, supplierId: true, items: { select: { value: true } },
          supplier: { select: { companyName: true, contactName: true, phone: true, email: true } },
        },
      }),
    ),
    withQuotes ? listQuotes(actor, eventId, now) : null,
    withValues && isSupplierDirector(actor, eventId) ? listEventRatings(actor, eventId) : null,
  ]);
  // Um fornecedor por linha: os itens que ganhou e os contratos dele.
  const bySupplier = new Map<string, { id: string | null; name: string; contact: string; phone: string; email: string; items: string[] }>();
  for (const q of closed) {
    const c = q.chosen!;
    const key = c.supplierId ?? c.companyName;
    const row = bySupplier.get(key) ?? { id: c.supplierId, name: c.companyName, contact: c.contactName ?? "", phone: c.phone ?? "", email: c.email ?? "", items: [] };
    const item = q.costItem?.name ?? q.title;
    if (!row.items.includes(item)) row.items.push(item);
    bySupplier.set(key, row);
  }
  // Fornecedor com contrato que não veio de cotação fechada também entra.
  for (const c of contracts) {
    if (!bySupplier.has(c.supplierId)) {
      const x = c.supplier;
      bySupplier.set(c.supplierId, { id: c.supplierId, name: x.companyName, contact: x.contactName ?? "", phone: x.phone ?? "", email: x.email ?? "", items: [] });
    }
  }
  const contractsOf = (id: string | null) => contracts.filter((c) => c.supplierId === id);
  const ratingOf = new Map(ratings?.items.map((r) => [r.supplierId, r.eventAverage]) ?? []);
  const rows = [...bySupplier.values()]
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    .map((s) => {
      const cs = contractsOf(s.id);
      const nota = s.id ? ratingOf.get(s.id) : undefined;
      return [
        s.name, s.contact, s.phone, s.email, s.items.join("; "),
        cs.map((c) => `nº ${c.number} ${CONTRACT_STATUS[c.status]}`).join("; ") || "Sem contrato",
        ...(withValues ? [cs.length ? cs.reduce((t, c) => t + c.items.reduce((v, i) => v + Number(i.value), 0), 0) : null, nota == null ? "" : nota.toFixed(1)] : []),
      ];
    });
  const blocks: Block[] = [
    table("Fornecedores contratados",
      [col("Fornecedor", 26), col("Contato", 20), col("Telefone", 16), col("E-mail", 26), col("Itens", 40), col("Contrato", 22),
        ...(withValues ? [money("Valor dos contratos", 18), col("Nota", 8)] : [])],
      rows, "Nenhum fornecedor escolhido ainda.",
      withValues ? "Nota: média das avaliações do evento (1 a 5)." : undefined),
  ];
  if (quotes) {
    blocks.push(table("Cotações",
      [col("Cotação", 32), col("Item", 30), col("Situação", 24), col("Orçamentos", 11, { number: true }), col("Responsável", 20), col("Prazo", 14)],
      quotes.items.map((q) => [q.title, q.costItemName ?? "", QUOTE_STAGE[q.stage], q.count, q.responsible?.name ?? "", dateTime(q.dueAt, ctx.tz)]),
      "Nenhuma cotação."));
  }
  return blocks;
}

async function arrivalsBlocks({ actor, eventId, now, tz }: Ctx): Promise<Block[]> {
  const [a, s] = await Promise.all([listArrivals(actor, eventId, now), getSchedule(actor, eventId, now)]);
  const toAssemble = s.items.filter((i) => i.assembly);
  return [
    {
      kind: "facts",
      title: "Resumo da montagem",
      rows: [
        ["Chegadas", `${a.totals.total}`],
        ["Já chegaram", `${a.totals.arrived}`],
        ["Montadas", `${a.totals.done}`],
        ["Atrasadas", `${a.totals.late}`],
        ["Itens montados", `${toAssemble.filter((i) => i.assembly!.done).length} de ${toAssemble.length}`],
      ],
    },
    table("Chegadas",
      [col("Dia", 11), col("Das", 7), col("Até", 7), col("Fornecedor", 24), col("Área", 16), col("Itens", 36), col("Doca / acesso", 14), col("Veículo", 16), col("Responsável", 20), col("Situação", 12)],
      a.items.map((r) => [
        day(r.day), time(r.scheduledAt, tz), time(r.endsAt, tz), r.supplierName, r.area ?? "",
        r.items.map((i) => (i.quantity ? `${i.name} (${i.quantity.toLocaleString("pt-BR")}${i.unit ? ` ${i.unit}` : ""})` : i.name)).join("; "),
        r.dock ?? "", [r.vehicle, r.plate].filter(Boolean).join(" "), r.responsible ?? "",
        r.late ? "Atrasada" : ARRIVAL_STATUS[r.status].label,
      ]),
      "Nenhuma chegada agendada."),
    table("Itens a montar",
      [col("Código", 16), col("Item", 34), col("Área", 16), col("Montar até", 14), col("Status", 14), col("Situação", 12)],
      toAssemble.map((i) => [i.code, i.name, i.area ?? "", dateTime(new Date(i.assembly!.until), tz), ITEM_STATUS_LABEL[i.status], i.assembly!.done ? "Montado" : i.assembly!.late ? "Atrasado" : "No prazo"]),
      "Nenhum item no mapa de montagem."),
  ];
}

async function pendenciesBlocks({ actor, eventId, now }: Ctx): Promise<Block[]> {
  const p = await listPendencies(actor, eventId, {}, now);
  const title = (g: string) => GROUPS.find((x) => x.key === g)?.title ?? "Depois";
  return [
    {
      kind: "facts",
      title: "Resumo",
      rows: [["Atrasadas", `${p.totals.late}`], ["Vencem hoje", `${p.totals.today}`], ["Próximos 7 dias", `${p.totals.week}`], ["Sem data", `${p.totals.undated}`], ["Depois", `${p.totals.later}`]],
    },
    table("Pendências",
      [col("Quando", 14), col("Tipo", 11), col("Pendência", 44), col("Detalhe", 30), col("Prazo", 11), col("Dias de atraso", 9, { number: true }), col("Área", 16), col("Responsável", 20)],
      p.items.map((x) => [title(x.group), KIND_LABEL[x.kind], x.title, x.detail ?? "", day(x.dueOn), x.lateDays || null, x.area?.name ?? "", x.responsible?.name ?? ""]),
      "Nenhuma pendência aberta."),
  ];
}

async function teamBlock({ actor, eventId }: Ctx): Promise<Block> {
  const f = await getFunctionsPanel(actor, eventId);
  const fn = new Map(f.functions.map((x) => [x.id, x.name]));
  return table("Equipe",
    [col("Nome", 26), col("Papel", 14), col("Área", 16), col("Equipe", 16), col("Função", 22), col("Telefone", 16)],
    f.people.map((p) => [p.name, ROLE_LABEL[p.role], p.area?.name ?? "", p.team?.name ?? "", p.functionId ? (fn.get(p.functionId) ?? "") : "", p.phone ?? ""]),
    "Ninguém na equipe ainda.");
}

/** Chamados do evento por equipe (o mesmo que o relatório diário lê, sem valores). */
async function ticketsBlock({ actor, eventId, now }: Ctx): Promise<Block> {
  const raw = await actor.run((tx) =>
    tx.$queryRaw<{ area_name: string; team_name: string; status: string; sla_due_at: Date | null; concluded_at: Date | null; sla_breached: boolean | null }[]>`
      SELECT area_name, team_name, status, sla_due_at, concluded_at, sla_breached FROM app.report_occurrences(${eventId}::uuid)`,
  );
  const teams = new Map<string, { area: string; team: string; total: number; open: number; done: number; late: number }>();
  for (const o of raw) {
    const k = `${o.area_name}\u0000${o.team_name}`;
    const t = teams.get(k) ?? { area: o.area_name, team: o.team_name, total: 0, open: 0, done: 0, late: 0 };
    t.total++;
    if (o.status === "CONCLUIDO") t.done++;
    else if (o.status !== "CANCELADO") t.open++;
    if (o.sla_breached || (o.status !== "CONCLUIDO" && o.status !== "CANCELADO" && o.sla_due_at && o.sla_due_at < now)) t.late++;
    teams.set(k, t);
  }
  const rows = [...teams.values()].sort((a, b) => a.area.localeCompare(b.area, "pt-BR") || a.team.localeCompare(b.team, "pt-BR"));
  return table("Chamados por equipe",
    [col("Área", 18), col("Equipe", 20), col("Chamados", 10, { number: true }), col(STATUS_LABEL.CONCLUIDO + "s", 11, { number: true }), col("Em aberto", 10, { number: true }), col("Fora do prazo", 12, { number: true })],
    rows.map((t) => [t.area, t.team, t.total, t.done, t.open, t.late]),
    "Nenhum chamado aberto no evento.");
}

async function fieldItemsBlock({ actor, eventId }: Ctx): Promise<Block> {
  const map = await listItemMap(actor, eventId);
  const rows = [...map.items].sort((a, b) => (a.areaName ?? "~").localeCompare(b.areaName ?? "~", "pt-BR") || a.number - b.number);
  return table("Itens por área",
    [col("Área", 16), col("Código", 16), col("Item", 34), col("Qtd.", 8, { number: true }), col("Unid.", 8), col("Status", 14), col("Fornecedor", 24), col("Local", 18)],
    rows.map((i) => [i.areaName ?? "Sem área", i.code, i.name, i.quantity, i.unit ?? "", ITEM_STATUS_LABEL[i.status], i.supplier ?? "", i.location ?? ""]),
    "Nenhum item no evento.");
}

async function financeBlocks({ actor, eventId }: Ctx): Promise<Block[]> {
  const [b, contracts] = await Promise.all([getBudget(actor, eventId), listContracts(actor, eventId)]);
  const t = b.totals;
  const groupCols = (first: string) => [col(first, 24), money("Estimado"), money("Cotado"), money("Contratado"), money("Realizado"), money("Economia"), money("Estouro")];
  const groupRow = (label: string, g: typeof t) => [label, g.estimated, g.quoted, g.contracted, g.actual, g.saving, g.overrun];
  return [
    {
      kind: "facts",
      title: "Resumo",
      rows: [
        ["Orçamento aprovado", b.approved.value === null ? "Não informado" : brl(b.approved.value)],
        ["Estimado", brl(t.estimated)],
        ["Cotado", brl(t.quoted)],
        ["Contratado", `${brl(t.contracted)} (${t.withContracted} de ${t.items} itens)`],
        ["Realizado", `${brl(t.actual)} (${t.withActual} de ${t.items} itens)`],
        [t.saving >= 0 ? "Economia" : "Contratou acima do estimado", brl(Math.abs(t.saving))],
        [t.overrun > 0 ? "Estouro" : "Pagou abaixo do contratado", brl(Math.abs(t.overrun))],
        ...(b.approved.value === null ? [] : [["Saldo do orçamento", brl(b.approved.left!)] as [string, string]]),
      ],
    },
    table("Por categoria", groupCols("Categoria"), b.byCategory.map((g) => groupRow(g.key ? CATEGORY[g.key as ItemCategory].label : "Sem categoria", g)), "Nenhum item."),
    table("Por centro de custo", groupCols("Centro de custo"), b.byCostCenter.map((g) => groupRow(g.key ? COST_CENTER_LABEL[g.key] : "Sem centro de custo", g)), "Nenhum item."),
    table("Itens",
      [col("Código", 16), col("Item", 34), col("Categoria", 18), col("Status", 14), money("Estimado"), money("Cotado"), money("Contratado"), money("Realizado"), money("Economia"), money("Estouro")],
      b.items.map((i) => [i.code, i.optional ? `${i.name} (opcional)` : i.name, category(i.category), ITEM_STATUS_LABEL[i.status], i.estimated, i.quoted, i.contracted, i.actual, i.saving, i.overrun]),
      "Nenhum item.",
      "Economia = Estimado − Contratado. Estouro = Realizado − Contratado. Os totais contam só os itens que já têm os dois valores; itens opcionais ficam fora."),
    table("Contratos",
      [col("Nº", 6, { number: true }), col("Fornecedor", 28), col("Situação", 12), col("Itens", 8, { number: true }), money("Valor"), col("Assinado em", 13)],
      contracts.items.map((c) => [c.number, c.supplier, CONTRACT_STATUS[c.status], c.items, c.total, c.signedOn ? day(c.signedOn.toISOString().slice(0, 10)) : ""]),
      "Nenhum contrato."),
  ];
}

async function executiveBlocks({ actor, eventId, now }: Ctx): Promise<Block[]> {
  const x = await getExecutivePanel(actor, eventId, now);
  const t = x.totals;
  return [
    {
      kind: "facts",
      title: "Os 4 valores",
      rows: [
        ["Estimado", `${brl(t.estimated)} (${t.items} itens)`],
        ["Cotado", `${brl(t.quoted)} (${t.withQuoted} cotados)`],
        ["Contratado", `${brl(t.contracted)} (${t.withContracted} contratados)`],
        ["Realizado", `${brl(t.actual)} (${t.withActual} pagos)`],
        [t.saving >= 0 ? "Economia" : "Contratou acima do estimado", brl(Math.abs(t.saving))],
        [t.overrun > 0 ? "Estouro" : "Pagou abaixo do contratado", brl(Math.abs(t.overrun))],
        ["Orçamento aprovado", x.approved.value === null ? "Não informado" : `${brl(x.approved.value)} (${x.approved.contractedPct}% contratado)`],
      ],
    },
    {
      kind: "facts",
      title: "Andamento",
      rows: [
        ["Cronograma", `${x.schedule.done} de ${x.schedule.total} marcos (${x.schedule.pct}%)`],
        ["Pendências atrasadas", `${x.pendencies.late}`],
        ["Vencem hoje", `${x.pendencies.today}`],
      ],
    },
    table("Maiores riscos", [col("Risco", 50), col("Gravidade", 12)], x.risks.map((r) => [r.text, r.tone === "red" ? "Alta" : "Atenção"]), "Nada atrasado nem esperando decisão."),
    table("Por categoria",
      [col("Categoria", 24), money("Estimado"), money("Contratado"), money("Realizado"), money("Economia / estouro", 18)],
      x.byCategory.map((g) => [g.key ? CATEGORY[g.key as ItemCategory].label : "Sem categoria", g.estimated, g.withContracted ? g.contracted : null, g.withActual ? g.actual : null, g.saving - g.overrun]),
      "Nenhum item.", "Positivo: economizou. Negativo: gastou mais."),
    table("Maiores estouros", [col("Código", 16), col("Item", 34), money("Acima do contratado", 18)], x.overruns.map((r) => [r.code, r.name, r.value]), "Nenhum item pago acima do contratado."),
    table("Contratados acima do estimado", [col("Código", 16), col("Item", 34), money("Acima do estimado", 18)], x.aboveEstimate.map((r) => [r.code, r.name, r.value]), "Nenhum item contratado acima do estimado."),
  ];
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// ───────────────────────────── relatórios ─────────────────────────────

const BUILDERS: Record<ReportKey, (ctx: Ctx) => Promise<Block[]>> = {
  book: async (ctx) => {
    const [ficha, briefing, schedule, items, suppliers, arrivals, team] = await Promise.all([
      fichaBlock(ctx), briefingBlocks(ctx), scheduleBlock(ctx), itemsBlock(ctx, false), suppliersBlocks(ctx, false, false), arrivalsBlocks(ctx), teamBlock(ctx),
    ]);
    return [ficha, ...briefing, schedule, items[1]!, ...suppliers, ...arrivals.slice(1), team];
  },
  // Master de itens: os 4 valores só para o diretor.
  itens: (ctx) => itemsBlock(ctx, ctx.director),
  fornecedores: (ctx) => suppliersBlocks(ctx, ctx.director, true),
  montagem: arrivalsBlocks,
  pendencias: pendenciesBlocks,
  // Campo: nunca com valores, nem para o diretor.
  campo: async (ctx) => {
    const [ficha, items, tickets, arrivals, team] = await Promise.all([fichaBlock(ctx), fieldItemsBlock(ctx), ticketsBlock(ctx), arrivalsBlocks(ctx), teamBlock(ctx)]);
    return [ficha, items, tickets, arrivals[1]!, team];
  },
  financeiro: financeBlocks,
  executivo: executiveBlocks,
};
