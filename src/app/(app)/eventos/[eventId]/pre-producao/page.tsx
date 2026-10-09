import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canReviewSla, canUseField, canUsePreProduction } from "@/server/authz/policy";
import { isEventAdmin, isEventSupport, membershipFor } from "@/server/authz/actor";
import { getEvent, getEventFinances } from "@/modules/events/events.service";
import { getEventBriefing } from "@/modules/events/briefing.service";
import { listDocuments } from "@/modules/documents/documents.service";
import { EventStages } from "@/components/event-stages";
import { listServiceTypes } from "@/modules/service-types/service-types.service";
import { getCostSheet } from "@/modules/costs/costs.service";
import { getFunctionsPanel } from "@/modules/functions/functions.service";
import { quotesSummary } from "@/modules/quotes/quotes.service";
import { visitsSummary } from "@/modules/visits/visits.service";
import { pendenciesSummary } from "@/modules/pendencies/pendencies.service";
import { getSchedule } from "@/modules/schedule/schedule.service";
import { arrivalsSummary } from "@/modules/arrivals/arrivals.service";
import { itemStages } from "@/modules/panels/panels.service";
import { canCloseEvent } from "@/modules/closure/closure.service";
import { financialSummary } from "@/modules/finance/closing.service";
import { TopBar } from "@/components/top-bar";
import { EventTabs } from "@/components/event-nav";
import { PAGE, cx } from "@/components/ui";
import { type TileData, Bars, MobileHero, PageHeading, Panel, Profile, ProgressRow, Ring, SquareTile, Tile, pct } from "@/components/panel";
import { ROLE_LABEL, formatDate, formatDateTime, formatDuration, formatPeriod } from "@/lib/format";
import { brl } from "@/lib/money";

export const metadata = { title: "Pré-produção" };

/** Uma cor por grupo de etapas do item, de A definir (cinza) a Finalizado (verde escuro). */
const STAGE_COLOR = ["bg-white/30", "bg-amber-400", "bg-violet-500", "bg-sky-500", "bg-brand-cyan", "bg-pink-500", "bg-emerald-500", "bg-emerald-800"];

/**
 * Painel da pré-produção: quanto falta em cada parte da preparação, o custo
 * total e atalhos para cada página.
 */
export default async function PreProductionPanel({ params }: PageProps<"/eventos/[eventId]/pre-producao">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!canUsePreProduction(actor, eventId)) notFound();
  const [event, types, sheet, fn, quotes, visits, finances, brief, docs, pending, schedule, arrivals, money] = await Promise.all([
    getEvent(actor, eventId), listServiceTypes(actor, eventId), getCostSheet(actor, eventId), getFunctionsPanel(actor, eventId),
    quotesSummary(actor, eventId), visitsSummary(actor, eventId), getEventFinances(actor, eventId), getEventBriefing(actor, eventId),
    listDocuments(actor, eventId), pendenciesSummary(actor, eventId), getSchedule(actor, eventId), arrivalsSummary(actor, eventId),
    financialSummary(actor, eventId),
  ]);
  const manager = canReviewSla(actor, eventId);
  const quoteAlert = manager ? quotes.noDeadline + quotes.toDecide + quotes.late : quotes.late;
  const quoteLine = quotes.total === 0 ? "Nenhuma cotação ainda"
    : [
        quotes.late && `${quotes.late} atrasada${quotes.late > 1 ? "s" : ""}`,
        manager && quotes.noDeadline && `${quotes.noDeadline} sem prazo`,
        manager && quotes.toDecide && `${quotes.toDecide} para escolher`,
      ].filter(Boolean).join(" · ") || `${quotes.closed} de ${quotes.total} fechadas`;
  const base = `/eventos/${eventId}/pre-producao`;
  const toReview = canReviewSla(actor, eventId) ? types.filter((t) => t.pending) : [];
  const proposed = types.filter((t) => t.pending).length;
  const approved = types.filter((t) => t.slaMinutes).length;
  const withPeople = types.filter((t) => t.peopleIds.length).length;
  const people = fn.people.length;
  const withFunction = fn.people.filter((p) => p.functionId).length;
  const fullProfile = fn.people.filter((p) => p.profileFilled === 5).length;
  const briefed = fn.people.filter((p) => p.briefingState !== "SEM");
  const read = briefed.filter((p) => p.briefingState === "LIDO").length;
  const priced = sheet.itemCount - sheet.totals.undefinedCount;
  const allItems = sheet.sections.flatMap((s) => s.items);
  const toDefine = allItems.filter((i) => i.status === "A_DEFINIR").length;
  const noOwner = allItems.filter((i) => !i.responsibleId).length;
  const stages = itemStages(allItems.map((i) => i.status));
  const role = isEventSupport(actor, eventId) ? "Suporte" : isEventAdmin(actor, eventId) ? ROLE_LABEL.ADMIN : ROLE_LABEL[membershipFor(actor, eventId)!.role];

  const tiles: TileData[] = [
    ...(manager ? [{ href: `${base}/executivo`, icon: "chart" as const, title: "Painel executivo", line: "Os 4 valores, economia, estouro e riscos" }] : []),
    {
      href: `${base}/briefing-evento`, icon: "briefing", title: "Briefing do evento",
      line: brief.updatedAt ? `${brief.progress.answered} de 13 frentes · ${brief.progress.needed} precisam` : "Ainda não preenchido",
    },
    {
      href: `${base}/pendencias`, icon: "pending", title: "Pendências", alert: pending.late > 0,
      line: pending.late ? `${pending.late} atrasada${pending.late > 1 ? "s" : ""} · ${pending.today} vence${pending.today === 1 ? "" : "m"} hoje`
        : pending.today ? `${pending.today} vence${pending.today === 1 ? "" : "m"} hoje · ${pending.week} na semana` : `Nada atrasado · ${pending.week} na semana`,
    },
    {
      href: `${base}/cronograma`, icon: "calendar", title: "Cronograma", alert: schedule.late > 0,
      line: `${schedule.progress.done} de ${schedule.progress.total} marcos feitos${schedule.late ? ` · ${schedule.late} atrasado${schedule.late > 1 ? "s" : ""}` : ""}`,
    },
    {
      href: `${base}/montagem`, icon: "truck", title: "Mapa de montagem", alert: !!arrivals?.late,
      line: arrivals?.total ? `${arrivals.total} chegadas · ${arrivals.arrived} chegaram${arrivals.late ? ` · ${arrivals.late} atrasada${arrivals.late > 1 ? "s" : ""}` : ""}` : "Chegadas dos fornecedores na montagem",
    },
    { href: `${base}/tipos`, icon: "sla", title: "Tipos e SLA", line: proposed ? `${proposed} aguardando revisão` : `${types.length} tipos · ${approved} com SLA`, alert: toReview.length > 0 },
    {
      href: `${base}/itens`, icon: "items", title: "Mapa de itens",
      line: sheet.itemCount ? `${sheet.itemCount} itens · ${toDefine} a definir · ${noOwner} sem responsável` : "Nenhum item ainda",
    },
    { href: `${base}/orcamento`, icon: "costs", title: "Orçamento", line: sheet.itemCount ? `Planilha ${brl(sheet.totals.total)}` : "Planilha vazia" },
    ...(money
      ? [{
          href: `${base}/financeiro`, icon: "costs" as const, title: "Fechamento financeiro",
          alert: money.status === "FECHAMENTO" && money.needed && !money.closed,
          line: money.closed ? `Fechado em ${formatDate(money.closed.at)}`
            : !money.needed ? "Nenhum item contratado ainda"
            : money.pending ? `${money.pending} ${money.pending === 1 ? "item falta" : "itens faltam"} · a pagar ${brl(money.toPay)}`
            : money.status === "FECHAMENTO" ? "Tudo pago: pode fechar" : "Tudo pago · fecha na etapa Fechamento",
        }]
      : []),
    { href: `${base}/cotacoes`, icon: "quotes", title: "Cotações", line: quoteLine, alert: quoteAlert > 0 },
    {
      href: `${base}/visitas`, icon: "visit", title: "Visitas técnicas",
      line: visits.next ? `Próxima: ${formatDateTime(visits.next.scheduledAt)} · ${visits.next.responsible.name}` : visits.total ? `${visits.total} feitas` : "Nenhuma marcada",
    },
    {
      href: `${base}/documentos`, icon: "docs", title: "Documentos",
      line: docs.documents.length ? `${docs.documents.length} ${docs.documents.length === 1 ? "arquivo" : "arquivos"} · ${docs.documents.filter((d) => d.visibleToField).length} no campo` : "Nenhum enviado",
    },
    { href: `${base}/funcoes`, icon: "functions", title: "Produtores e Funções", line: `${fn.functions.length} funções · ${people - withFunction} sem função` },
    { href: `${base}/relatorios`, icon: "report", title: "Relatórios", line: "Book, itens, fornecedores, montagem e mais, em PDF e Excel" },
  ];

  return (
    <>
      <TopBar title="Pré-produção" subtitle={event.name} />
      {canUseField(actor, eventId) && <EventTabs eventId={eventId} active="pre" />}
      <main className={cx(PAGE, "py-4 lg:py-6")}>
        <PageHeading trail={[event.name, "Pré-produção"]} title="Painel da pré-produção" />
        <MobileHero name={actor.name} role={role} detail={event.name} />
        <EventStages status={event.status} className="mb-4" />
        {event.status === "CONCLUIDO" && canCloseEvent(actor, eventId) && (
          <Link
            href={`/eventos/${eventId}/encerramento`}
            className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-amber-400/50 bg-amber-400/10 p-4 transition hover:border-amber-300"
          >
            <span className="min-w-0">
              <b className="text-amber-200">Evento concluído: baixe o histórico e encerre</b>
              <span className="block text-sm text-muted">Guarde os relatórios, fotos e documentos. Depois o app apaga tudo e fica só um resumo.</span>
            </span>
            <span className="shrink-0 text-sm font-semibold text-amber-200">Abrir ›</span>
          </Link>
        )}
        {pending.late > 0 && (
          <Link
            href={`${base}/pendencias`}
            className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-red-500/50 bg-red-500/10 p-4 transition hover:border-red-400"
          >
            <span className="min-w-0">
              <b className="text-red-300">{pending.late} {pending.late === 1 ? "pendência atrasada" : "pendências atrasadas"}</b>
              <span className="block text-sm text-muted">Crítico: resolva primeiro. Veja tudo na Central de pendências.</span>
            </span>
            <span className="shrink-0 text-sm font-semibold text-red-300">Ver ›</span>
          </Link>
        )}
        <div className="gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-4">
            {/* Celular: cartões quadrados; computador: atalhos em linha. */}
            <div className="grid grid-cols-2 gap-3 lg:hidden">
              {tiles.map((t, i) => <SquareTile key={t.href} href={t.href} icon={t.icon} title={t.title} line={t.line} tone={t.alert ? "alert" : undefined} i={i} />)}
            </div>
            <div className="hidden gap-3 lg:grid lg:grid-cols-2">
              {tiles.map((t, i) => <Tile key={t.href} href={t.href} icon={t.icon} title={t.title} line={t.line} tone={t.alert ? "alert" : undefined} i={i} />)}
            </div>

            {toReview.length > 0 && (
              <Panel title={`Aguardando sua revisão (${toReview.length})`}>
                <ul className="divide-y divide-border">
                  {toReview.map((t) => (
                    <li key={t.id}>
                      <Link href={`${base}/tipos/${t.id}`} className="flex items-center justify-between gap-3 py-2.5 transition hover:text-primary">
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{t.name}</span>
                          <span className="block truncate text-sm text-muted">{t.pending!.proposedBy.name} propôs {formatDuration(t.pending!.minutes * 60)} · {t.teamName}</span>
                        </span>
                        <span className="shrink-0 text-sm font-semibold text-amber-300">Revisar ›</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            {stages.total > 0 && (
              <Panel title="Itens por etapa" action={<Link href={`${base}/itens`} className="text-sm font-semibold text-primary">Mapa de itens ›</Link>}>
                <div className="flex h-3 overflow-hidden rounded-full bg-white/5" aria-hidden>
                  {stages.groups.filter((g) => g.count).map((g, i) => (
                    <span key={g.key} style={{ width: `${(g.count / stages.total) * 100}%` }} className={cx(STAGE_COLOR[stages.groups.indexOf(g)], i > 0 && "border-l-2 border-background")} />
                  ))}
                </div>
                <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-4">
                  {stages.groups.map((g, i) => (
                    <li key={g.key} className={cx("flex items-center gap-2", !g.count && "text-muted")}>
                      <span className={cx("h-2.5 w-2.5 shrink-0 rounded-full", STAGE_COLOR[i])} />
                      <span className="min-w-0 flex-1 truncate">{g.label}</span>
                      <b className="tabular-nums">{g.count}</b>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-sm text-muted">{stages.atVenue} de {stages.total} itens já estão no local do evento.</p>
              </Panel>
            )}

            <Panel title="Andamento da preparação">
              <div className="space-y-1">
                <ProgressRow label="SLA aprovado" done={approved} total={types.length} hint={`${approved} de ${types.length} tipos`} i={0} href={`${base}/tipos`} />
                <ProgressRow label="Quem atende" done={withPeople} total={types.length} hint={`${withPeople} de ${types.length} tipos`} i={1} href={`${base}/quem-faz`} />
                <ProgressRow label="Funções" done={withFunction} total={people} hint={`${withFunction} de ${people} produtores`} i={2} href={`${base}/funcoes`} />
                <ProgressRow label="Fichas" done={fullProfile} total={people} hint={`${fullProfile} de ${people} completas`} i={3} href={`${base}/funcoes`} />
                <ProgressRow label="Briefing lido" done={read} total={briefed.length} hint={`${read} de ${briefed.length} pessoas`} i={4} href={`${base}/funcoes`} />
                {quotes.total > 0 && (
                  <ProgressRow label="Cotações" done={quotes.closed} total={quotes.total} hint={`${quotes.closed} de ${quotes.total} fechadas`} i={1} href={`${base}/cotacoes`} />
                )}
                <ProgressRow label="Orçamento" done={priced} total={sheet.itemCount} hint={`${priced} de ${sheet.itemCount} itens com valor`} i={5} href={`${base}/orcamento`} />
                {sheet.field.sent > 0 && (
                  <ProgressRow label="Conferidos" done={sheet.field.ok + sheet.field.different} total={sheet.field.sent} hint={`${sheet.field.ok + sheet.field.different} de ${sheet.field.sent} itens no campo`} i={0} href={`${base}/relatorio`} />
                )}
              </div>
            </Panel>
          </div>

          <aside className="mt-4 space-y-4 lg:mt-0">
            <Panel className="hidden lg:block"><Profile name={actor.name} role={role} detail={event.name} /></Panel>
            <Panel title="Custo do evento" action={<Link href={`${base}/orcamento`} className="text-sm font-semibold text-primary">Abrir ›</Link>}>
              <p className="text-3xl font-bold tabular-nums">{brl(sheet.totals.total)}</p>
              <dl className="mt-3 space-y-1.5 text-sm">
                {finances?.approvedBudget != null && (
                  <>
                    <Line label="Orçamento aprovado" value={brl(finances.approvedBudget)} />
                    <Line
                      label={finances.approvedBudget >= sheet.totals.total ? "Saldo" : "Estouro"}
                      value={brl(Math.abs(finances.approvedBudget - sheet.totals.total))}
                      tone={finances.approvedBudget >= sheet.totals.total ? "text-emerald-300" : "text-red-300"}
                    />
                  </>
                )}
                <Line label="Fornecedores" value={brl(sheet.totals.suppliers)} />
                <Line label="Honorários" value={brl(sheet.totals.fee)} />
                <Line label="Impostos" value={brl(sheet.totals.invoiceTax + sheet.totals.nfTax)} />
                {sheet.totals.undefinedCount > 0 && <Line label="Itens sem valor" value={String(sheet.totals.undefinedCount)} tone="text-amber-300" />}
              </dl>
            </Panel>
            <Panel
              title="Ficha do evento"
              action={canReviewSla(actor, eventId) ? <Link href={`/eventos/${eventId}/editar`} className="text-sm font-semibold text-primary">Editar ›</Link> : undefined}
            >
              <dl className="space-y-1.5 text-sm">
                <Line label="Evento" value={formatPeriod(event.startsAt, event.endsAt, event.timezone)} />
                {event.setupStartsAt && <Line label="Montagem" value={formatPeriod(event.setupStartsAt, event.setupEndsAt, event.timezone)} />}
                {event.teardownStartsAt && <Line label="Desmontagem" value={formatPeriod(event.teardownStartsAt, event.teardownEndsAt, event.timezone)} />}
                {event.expectedAudience != null && <Line label="Público" value={`${event.expectedAudience.toLocaleString("pt-BR")} pessoas`} />}
                <Line label="Responsável" value={event.lead?.name ?? "—"} />
                <Line label="Produtor" value={event.producer?.name ?? "—"} />
                {finances?.costCenter && <Line label="Centro de custo" value={finances.costCenter} />}
              </dl>
            </Panel>
            <Panel title="Situação">
              <div className="grid grid-cols-3 gap-2">
                <Ring value={schedule.progress.total ? schedule.progress.pct : null} label="Cronograma" i={1} />
                <Ring value={stages.total ? pct(stages.atVenue, stages.total) : null} label="No local" i={3} />
                <Ring value={types.length ? pct(approved, types.length) : null} label="SLA" i={0} />
                <Ring value={people ? pct(withFunction, people) : null} label="Funções" i={2} />
                <Ring value={briefed.length ? pct(read, briefed.length) : null} label="Briefing" i={4} />
              </div>
            </Panel>
            {fn.functions.some((f) => f.peopleCount) && (
              <Panel title="Pessoas por função">
                <Bars rows={[...fn.functions].sort((a, b) => b.peopleCount - a.peopleCount).slice(0, 6).map((f) => ({ label: f.name, value: f.peopleCount }))} />
              </Panel>
            )}
          </aside>
        </div>
      </main>
    </>
  );
}

function Line({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={cx("font-semibold tabular-nums", tone)}>{value}</dd>
    </div>
  );
}

/** "10/04 a 12/04" no fuso do evento (um dia só: "10/04"). */
