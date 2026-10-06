import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUseField, canUsePreProduction } from "@/server/authz/policy";
import { getDailyReport } from "@/modules/reports/reports.service";
import type { ReportOccurrence } from "@/modules/reports/report";
import { TopBar } from "@/components/top-bar";
import { EventTabs } from "@/components/event-nav";
import { Card, EmptyState, PAGE, SectionTitle, Stat, StatusBadge, cx } from "@/components/ui";
import { PRIORITY_LABEL, formatDateTime, formatDuration } from "@/lib/format";
import { decimal } from "@/lib/money";
import { NoteForm } from "./note-form";

export const metadata = { title: "Relatório diário" };

function dayChip(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  const week = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" }).format(d).replace(".", "");
  return { week, date: `${day.slice(8, 10)}/${day.slice(5, 7)}` };
}

const pct = (s: { pct: number | null; total: number }) => (s.pct === null ? "—" : `${s.pct}%`);

/**
 * Relatório diário: chamados e recebimentos do dia, montados sozinhos, mais
 * as observações do gestor. Gerente e Pré-produtor veem.
 */
export default async function ReportPage({ params, searchParams }: PageProps<"/eventos/[eventId]/pre-producao/relatorio">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!canUsePreProduction(actor, eventId)) notFound();
  const dia = (await searchParams).dia;
  const r = await getDailyReport(actor, eventId, typeof dia === "string" ? dia : null).catch((e) => {
    if ((e as { status?: number }).status === 422) notFound();
    throw e;
  });
  const rep = r.report;
  const t = rep.totals;
  const base = `/eventos/${eventId}/pre-producao/relatorio`;
  const { week, date } = dayChip(rep.day);
  const lateCount = rep.lateOpen.length + rep.lateDone.length;

  return (
    <>
      <TopBar title="Relatório diário" subtitle={r.event.name} />
      {canUseField(actor, eventId) && <EventTabs eventId={eventId} active="pre" />}
      <main className={cx(PAGE, "py-4 lg:py-6")}>
        <nav aria-label="Dias do evento" className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:flex-wrap lg:px-0">
          {r.days.map((day) => {
            const c = dayChip(day);
            const active = day === rep.day;
            return (
              <Link
                key={day}
                href={`${base}?dia=${day}`}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "relative flex min-h-12 shrink-0 flex-col items-center justify-center rounded-xl border px-3 text-sm leading-tight transition",
                  active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface hover:border-primary/60",
                )}
              >
                <span className={cx("text-xs capitalize", active ? "opacity-80" : "text-muted")}>{c.week}</span>
                <span className="font-semibold tabular-nums">{c.date}</span>
                {r.daysWithNotes.includes(day) && <span className={cx("absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full", active ? "bg-primary-foreground" : "bg-primary")} aria-label="tem observações" />}
              </Link>
            );
          })}
        </nav>

        <div className="mb-3 flex flex-wrap items-end justify-between gap-3 px-1">
          <div>
            <h2 className="text-xl font-bold capitalize">{week}, {date}{rep.isToday && <span className="ml-2 text-sm font-semibold normal-case text-primary">hoje</span>}</h2>
            <p className="text-sm text-muted">
              {rep.isFuture ? "Este dia ainda não chegou." : rep.isToday ? "Até agora. Os números mudam ao longo do dia." : "Fechamento do dia."}
            </p>
          </div>
          <a href={`/api/events/${eventId}/report/export?dia=${rep.day}`} className="inline-flex min-h-11 items-center rounded-xl border border-border bg-surface px-4 text-sm font-semibold transition hover:border-primary/60">
            Baixar Excel
          </a>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <Stat label="Abertos no dia" value={t.opened} />
          <Stat label="Concluídos" value={t.concluded} />
          <Stat label={rep.isToday ? "Em aberto agora" : "Em aberto no fim"} value={t.openAtEnd} />
          <Stat label="Atrasados" value={t.late} tone={t.late ? "text-red-400" : undefined} />
          <Stat label={`Dentro do SLA${t.sla.total ? ` (${t.sla.ok} de ${t.sla.total})` : ""}`} value={pct(t.sla)} tone={t.sla.pct !== null && t.sla.pct < 80 ? "text-amber-300" : undefined} />
          <Stat label="Tempo médio" value={<span className="text-2xl">{formatDuration(t.avgSeconds)}</span>} />
        </div>

        <div className="lg:grid lg:grid-cols-3 lg:items-start lg:gap-6">
          <div className="lg:col-span-2">
            <SectionTitle>Atrasados e urgentes</SectionTitle>
            {lateCount + rep.urgent.length === 0 ? (
              <EmptyState title="Nenhum chamado atrasado ou urgente neste dia" />
            ) : (
              <div className="space-y-2">
                {rep.lateOpen.map((o) => <OccLine key={`lo${o.id}`} o={o} tag="Atrasado" tone="text-red-400" eventId={eventId} link={r.can.openTickets} />)}
                {rep.lateDone.map((o) => <OccLine key={`ld${o.id}`} o={o} tag="Concluído com atraso" tone="text-amber-300" eventId={eventId} link={r.can.openTickets} />)}
                {rep.urgent.map((o) => <OccLine key={`u${o.id}`} o={o} tag={o.priority === "CRITICA" ? "Crítico" : "Urgente"} tone="text-red-400" eventId={eventId} link={r.can.openTickets} />)}
              </div>
            )}

            <SectionTitle>Por equipe</SectionTitle>
            {rep.byTeam.length === 0 ? (
              <EmptyState title="Nenhum chamado neste dia" />
            ) : (
              <>
              {/* Celular: uma linha por equipe. */}
              <Card className="p-0 sm:hidden">
                <ul className="divide-y divide-border text-sm">
                  {rep.byTeam.map((g) => (
                    <li key={`${g.areaName}/${g.teamName}`} className="px-4 py-3">
                      <p><span className="font-medium">{g.teamName}</span> <span className="text-muted">· {g.areaName}</span></p>
                      <p className="mt-0.5 text-muted tabular-nums">
                        {g.opened} abertos · {g.concluded} concluídos · {g.openAtEnd} em aberto
                        {g.late > 0 && <span className="font-semibold text-red-400"> · {g.late} atrasados</span>}
                        {g.sla.pct !== null && ` · ${pct(g.sla)} no SLA`}
                        {g.avgSeconds !== null && ` · média ${formatDuration(g.avgSeconds)}`}
                      </p>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card className="hidden overflow-x-auto p-0 sm:block">
                <table className="w-full min-w-[34rem] text-left text-sm">
                  <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-4 py-2 font-semibold">Equipe</th>
                      <th className="px-2 py-2 text-right font-semibold">Abertos</th>
                      <th className="px-2 py-2 text-right font-semibold">Concluídos</th>
                      <th className="px-2 py-2 text-right font-semibold">Em aberto</th>
                      <th className="px-2 py-2 text-right font-semibold">Atrasados</th>
                      <th className="px-2 py-2 text-right font-semibold">No SLA</th>
                      <th className="px-4 py-2 text-right font-semibold">Tempo médio</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border tabular-nums">
                    {rep.byTeam.map((g) => (
                      <tr key={`${g.areaName}/${g.teamName}`}>
                        <td className="px-4 py-2"><span className="font-medium">{g.teamName}</span> <span className="text-muted">· {g.areaName}</span></td>
                        <td className="px-2 py-2 text-right">{g.opened}</td>
                        <td className="px-2 py-2 text-right">{g.concluded}</td>
                        <td className="px-2 py-2 text-right">{g.openAtEnd}</td>
                        <td className={cx("px-2 py-2 text-right", g.late > 0 && "font-semibold text-red-400")}>{g.late}</td>
                        <td className="px-2 py-2 text-right">{pct(g.sla)}</td>
                        <td className="px-4 py-2 text-right">{formatDuration(g.avgSeconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
              </>
            )}

            {rep.byType.length > 0 && (
              <>
                <SectionTitle>Por tipo de atendimento</SectionTitle>
                <Card className="overflow-x-auto p-0">
                  <table className="w-full min-w-[28rem] text-left text-sm">
                    <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
                      <tr>
                        <th className="px-4 py-2 font-semibold">Tipo</th>
                        <th className="px-2 py-2 text-right font-semibold">Abertos</th>
                        <th className="px-2 py-2 text-right font-semibold">Concluídos</th>
                        <th className="px-2 py-2 text-right font-semibold">No SLA</th>
                        <th className="px-4 py-2 text-right font-semibold">Tempo médio</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border tabular-nums">
                      {rep.byType.map((g) => (
                        <tr key={g.name}>
                          <td className={cx("px-4 py-2", g.name === "Sem tipo" && "text-muted")}>{g.name}</td>
                          <td className="px-2 py-2 text-right">{g.opened}</td>
                          <td className="px-2 py-2 text-right">{g.concluded}</td>
                          <td className="px-2 py-2 text-right">{pct(g.sla)}</td>
                          <td className="px-4 py-2 text-right">{formatDuration(g.avgSeconds)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              </>
            )}
          </div>

          <div>
            <SectionTitle>Observações do dia</SectionTitle>
            <Card>
              {r.can.write ? (
                <NoteForm key={rep.day} eventId={eventId} day={rep.day} initial={r.note?.body ?? ""} />
              ) : r.note ? (
                <p className="whitespace-pre-line">{r.note.body}</p>
              ) : (
                <p className="text-sm text-muted">O gerente ainda não escreveu observações para este dia.</p>
              )}
              {r.note && (
                <p className="mt-2 text-xs text-muted">Atualizado em {formatDateTime(r.note.updatedAt)}{r.note.updatedBy ? ` por ${r.note.updatedBy}` : ""}</p>
              )}
            </Card>

            <SectionTitle>Recebimentos</SectionTitle>
            <Card>
              {rep.receipts.sent === 0 ? (
                <p className="text-sm text-muted">Nenhum item da planilha foi enviado para o campo.</p>
              ) : (
                <>
                  <p className="text-sm">
                    No dia: <span className="font-semibold text-emerald-300">{rep.receipts.ok} chegaram certo</span>
                    {" · "}<span className={cx("font-semibold", rep.receipts.different.length > 0 && "text-amber-300")}>{rep.receipts.different.length} diferentes</span>
                  </p>
                  <p className="mt-1 text-sm text-muted">Aguardando conferência agora: {rep.receipts.pendingNow} de {rep.receipts.sent}</p>
                  {rep.receipts.different.length > 0 && (
                    <ul className="mt-3 space-y-3 border-t border-border pt-3 text-sm">
                      {rep.receipts.different.map((x) => (
                        <li key={x.id}>
                          <p className="font-medium">{x.name}</p>
                          <p className="text-muted">
                            {x.receivedQuantity !== null && `Chegou ${decimal(x.receivedQuantity)} de ${decimal(x.quantity)} · `}
                            {x.receiverName}
                          </p>
                          {x.receivedDescription && <p className="mt-0.5">{x.receivedDescription}</p>}
                          {x.note && <p className="mt-0.5 text-amber-200/90">&ldquo;{x.note}&rdquo;</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </Card>
          </div>
        </div>
      </main>
    </>
  );
}

function OccLine({ o, tag, tone, eventId, link }: { o: ReportOccurrence; tag: string; tone: string; eventId: string; link: boolean }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 font-semibold"><span className="text-muted">#{o.number}</span> {o.title}</p>
        <StatusBadge status={o.status} />
      </div>
      <p className="mt-1 text-sm text-muted">
        <span className={cx("font-semibold", tone)}>{tag}</span>
        {" · "}{o.teamName} · {PRIORITY_LABEL[o.priority]}
        {" · "}aberto {formatDateTime(o.openedAt)}
        {o.slaDueAt && ` · prazo ${formatDateTime(o.slaDueAt)}`}
        {o.concludedAt && ` · concluído ${formatDateTime(o.concludedAt)}`}
      </p>
    </>
  );
  return link ? (
    <Link href={`/eventos/${eventId}/ocorrencias/${o.id}`} className="block rounded-2xl border border-border bg-surface p-4 transition hover:border-primary/60">{body}</Link>
  ) : (
    <Card>{body}</Card>
  );
}
