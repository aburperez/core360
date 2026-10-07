import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canReviewSla, canUseField, canUsePreProduction } from "@/server/authz/policy";
import { isEventAdmin, isEventSupport, membershipFor } from "@/server/authz/actor";
import { getEvent } from "@/modules/events/events.service";
import { listServiceTypes } from "@/modules/service-types/service-types.service";
import { getCostSheet } from "@/modules/costs/costs.service";
import { getFunctionsPanel } from "@/modules/functions/functions.service";
import { TopBar } from "@/components/top-bar";
import { EventTabs } from "@/components/event-nav";
import { PAGE, cx } from "@/components/ui";
import { type TileData, Bars, MobileHero, PageHeading, Panel, Profile, ProgressRow, Ring, SquareTile, Tile, pct } from "@/components/panel";
import { ROLE_LABEL, formatDuration } from "@/lib/format";
import { brl } from "@/lib/money";

export const metadata = { title: "Pré-produção" };

/**
 * Painel da pré-produção: quanto falta em cada parte da preparação, o custo
 * total e atalhos para cada página.
 */
export default async function PreProductionPanel({ params }: PageProps<"/eventos/[eventId]/pre-producao">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!canUsePreProduction(actor, eventId)) notFound();
  const [event, types, sheet, fn] = await Promise.all([
    getEvent(actor, eventId), listServiceTypes(actor, eventId), getCostSheet(actor, eventId), getFunctionsPanel(actor, eventId),
  ]);
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
  const role = isEventSupport(actor, eventId) ? "Suporte" : isEventAdmin(actor, eventId) ? "Admin" : ROLE_LABEL[membershipFor(actor, eventId)!.role];

  const tiles: TileData[] = [
    { href: `${base}/tipos`, icon: "sla", title: "Tipos e SLA", line: proposed ? `${proposed} aguardando revisão` : `${types.length} tipos · ${approved} com SLA`, alert: toReview.length > 0 },
    { href: `${base}/quem-faz`, icon: "matrix", title: "Quem faz o quê", line: `${withPeople} de ${types.length} tipos com pessoas` },
    { href: `${base}/custos`, icon: "costs", title: "Custos", line: sheet.itemCount ? brl(sheet.totals.total) : "Planilha vazia" },
    { href: `${base}/funcoes`, icon: "functions", title: "Funções e briefing", line: `${fn.functions.length} funções · ${people - withFunction} sem função` },
    { href: `${base}/relatorio`, icon: "report", title: "Relatório diário", line: "Chamados e recebimentos do dia" },
  ];

  return (
    <>
      <TopBar title="Pré-produção" subtitle={event.name} />
      {canUseField(actor, eventId) && <EventTabs eventId={eventId} active="pre" />}
      <main className={cx(PAGE, "py-4 lg:py-6")}>
        <PageHeading trail={[event.name, "Pré-produção"]} title="Painel da pré-produção" />
        <MobileHero name={actor.name} role={role} detail={event.name} />
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

            <Panel title="Andamento da preparação">
              <div className="space-y-1">
                <ProgressRow label="SLA aprovado" done={approved} total={types.length} hint={`${approved} de ${types.length} tipos`} i={0} href={`${base}/tipos`} />
                <ProgressRow label="Quem faz" done={withPeople} total={types.length} hint={`${withPeople} de ${types.length} tipos`} i={1} href={`${base}/quem-faz`} />
                <ProgressRow label="Funções" done={withFunction} total={people} hint={`${withFunction} de ${people} pessoas`} i={2} href={`${base}/funcoes`} />
                <ProgressRow label="Fichas" done={fullProfile} total={people} hint={`${fullProfile} de ${people} completas`} i={3} href={`${base}/funcoes`} />
                <ProgressRow label="Briefing lido" done={read} total={briefed.length} hint={`${read} de ${briefed.length} pessoas`} i={4} href={`${base}/funcoes`} />
                <ProgressRow label="Custos" done={priced} total={sheet.itemCount} hint={`${priced} de ${sheet.itemCount} itens com valor`} i={5} href={`${base}/custos`} />
                {sheet.field.sent > 0 && (
                  <ProgressRow label="Conferidos" done={sheet.field.ok + sheet.field.different} total={sheet.field.sent} hint={`${sheet.field.ok + sheet.field.different} de ${sheet.field.sent} itens no campo`} i={0} href={`${base}/relatorio`} />
                )}
              </div>
            </Panel>
          </div>

          <aside className="mt-4 space-y-4 lg:mt-0">
            <Panel className="hidden lg:block"><Profile name={actor.name} role={role} detail={event.name} /></Panel>
            <Panel title="Custo do evento" action={<Link href={`${base}/custos`} className="text-sm font-semibold text-primary">Abrir ›</Link>}>
              <p className="text-3xl font-bold tabular-nums">{brl(sheet.totals.total)}</p>
              <dl className="mt-3 space-y-1.5 text-sm">
                <Line label="Fornecedores" value={brl(sheet.totals.suppliers)} />
                <Line label="Honorários" value={brl(sheet.totals.fee)} />
                <Line label="Impostos" value={brl(sheet.totals.invoiceTax + sheet.totals.nfTax)} />
                {sheet.totals.undefinedCount > 0 && <Line label="Itens sem valor" value={String(sheet.totals.undefinedCount)} tone="text-amber-300" />}
              </dl>
            </Panel>
            <Panel title="Situação">
              <div className="grid grid-cols-3 gap-2">
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
