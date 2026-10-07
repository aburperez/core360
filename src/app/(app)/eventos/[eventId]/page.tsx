import { redirect } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUseField, canUsePreProduction } from "@/server/authz/policy";
import { isAgencyAdmin, isEventSupport } from "@/server/authz/actor";
import { getEvent } from "@/modules/events/events.service";
import { getDashboard } from "@/modules/dashboard/dashboard.service";
import { countMyPendingReceipts } from "@/modules/receipts/receipts.service";
import { myBriefingState } from "@/modules/briefings/briefings.service";
import { getMyPlan, myPlanSummary } from "@/modules/functions/functions.service";
import Link from "next/link";
import { TopBar } from "@/components/top-bar";
import { EventTabs } from "@/components/event-nav";
import { EmptyState, LinkButton, PAGE, PriorityText, SectionTitle, SlaPill, Stat, cx } from "@/components/ui";
import { Icon } from "@/components/icons";
import { type TileData, Bars, MobileHero, PageHeading, Panel, Profile, ProgressRow, Ring, SquareTile, pct, serie } from "@/components/panel";
import { OccurrenceCard, type OccurrenceRow } from "@/components/occurrence-card";
import { ROLE_LABEL, formatDuration } from "@/lib/format";

export const metadata = { title: "Gestão de campo" };

export default async function DashboardPage({ params }: PageProps<"/eventos/[eventId]">) {
  const actor = await requireUser();
  const { eventId } = await params;
  // Pré-produtor não tem campo: a casa dele é a Pré-produção.
  if (!canUseField(actor, eventId)) redirect(`/eventos/${eventId}/pre-producao`);
  const [event, dash, toReceive, briefing, plan] = await Promise.all([
    getEvent(actor, eventId), getDashboard(actor, eventId), countMyPendingReceipts(actor, eventId), myBriefingState(actor, eventId),
    myPlanSummary(actor, eventId),
  ]);
  const base = `/eventos/${eventId}`;
  const scopeLabel =
    dash.role === "HEAD" ? "da sua área" : dash.role === "OPERACIONAL" ? "da sua equipe" : "do evento";
  const multi = actor.memberships.length > 1 || isAgencyAdmin(actor) || actor.isPlatformAdmin;

  const role = isEventSupport(actor, eventId) ? "Suporte" : ROLE_LABEL[dash.role];
  const manager = dash.role === "ADMIN" || dash.role === "GERENTE";
  const agenda = plan.has ? ((await getMyPlan(actor, eventId))?.activities.filter((a) => !a.doneAt).slice(0, 4) ?? []) : [];

  const alerts = (
    <>
      {(briefing === "NAO_LIDO" || briefing === "MUDOU") && (
        <Link
          href={`${base}/briefing`}
          className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-amber-400/50 bg-amber-400/10 p-4 transition hover:border-amber-300"
        >
          <span className="flex items-center gap-3">
            <Icon name="briefing" className="h-6 w-6 shrink-0 text-amber-300" />
            <span>
              <span className="block font-semibold">{briefing === "MUDOU" ? "Seu briefing mudou" : "Leia seu briefing"}</span>
              <span className="block text-sm text-muted">O que você faz, onde e quando. Leia e confirme.</span>
            </span>
          </span>
          <Icon name="chevron" className="h-5 w-5 shrink-0 text-amber-300" />
        </Link>
      )}
      {toReceive > 0 && (
        <Link
          href={`${base}/recebimentos`}
          className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-primary/50 bg-primary/10 p-4 transition hover:border-primary"
        >
          <span className="flex items-center gap-3">
            <Icon name="receipts" className="h-6 w-6 shrink-0 text-primary" />
            <span>
              <span className="block font-semibold">{toReceive === 1 ? "1 item para conferir" : `${toReceive} itens para conferir`}</span>
              <span className="block text-sm text-muted">A pré-produção enviou itens para você receber.</span>
            </span>
          </span>
          <Icon name="chevron" className="h-5 w-5 shrink-0 text-primary" />
        </Link>
      )}
    </>
  );

  const header = (
    <>
      <TopBar title={event.name} subtitle={`${role} · ${actor.name}`} back={multi ? "/eventos?todos=1" : undefined} />
      {canUsePreProduction(actor, eventId) && <EventTabs eventId={eventId} active="campo" />}
    </>
  );

  // Cliente: só a estrutura do evento (não vê chamados).
  if ("structure" in dash) {
    return (
      <>
        {header}
        <main className={cx(PAGE, "py-4 lg:py-6")}>
          <PageHeading trail={[event.name, "Gestão de campo"]} title="Painel do campo" />
          <MobileHero name={actor.name} role={role} detail={event.name} />
          {alerts}
          <div className="grid grid-cols-3 gap-3 lg:max-w-2xl">
            <Stat label="Áreas" value={dash.structure.areas} />
            <Stat label="Equipes" value={dash.structure.teams} />
            <Stat label="Pessoas" value={dash.structure.people} />
          </div>
          <LinkButton href={`${base}/equipe`} className="mt-4 w-full lg:w-auto">Ver a equipe</LinkButton>
        </main>
      </>
    );
  }

  const t = dash.totals;
  const open = t.pendente + t.emAndamento + t.urgente + t.bloqueio;
  const tiles: TileData[] = [
    { href: `${base}/ocorrencias`, icon: "tickets", title: "Chamados", line: t.urgente ? `${open} abertos · ${t.urgente} urgentes` : `${open} abertos`, alert: t.urgente + t.bloqueio > 0 },
    { href: `${base}/ocorrencias/nova`, icon: "plus", title: "Novo chamado", line: "Abrir agora" },
    { href: `${base}/equipe`, icon: "team", title: manager ? "Montar equipe" : "Equipe", line: "Áreas, equipes e pessoas" },
    ...(briefing !== "SEM" || plan.has
      ? [{ href: `${base}/briefing`, icon: "briefing" as const, title: "Meu briefing", line: plan.pending ? `${plan.pending} atividades a fazer` : "Função e agenda" }]
      : []),
    ...(toReceive > 0 ? [{ href: `${base}/recebimentos`, icon: "receipts" as const, title: "Recebimentos", line: `${toReceive} a conferir`, alert: true }] : []),
    ...(manager ? [{ href: `${base}/editar`, icon: "edit" as const, title: "Dados do evento", line: "Nome, datas, local e fase" }] : []),
  ];
  const teams = dash.byTeam.slice(0, 6);

  return (
    <>
      {header}
      <main className={cx(PAGE, "py-4 lg:py-6")}>
        <PageHeading trail={[event.name, "Gestão de campo"]} title="Painel do campo" />
        <MobileHero name={actor.name} role={role} detail={event.name} />
        {alerts}
        <div className="gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:hidden">
              {tiles.map((x, i) => <SquareTile key={x.href} href={x.href} icon={x.icon} title={x.title} line={x.line} tone={x.alert ? "alert" : undefined} i={i} />)}
            </div>

            {/* No celular os cartões e o quadro já mostram os números. */}
            <div className="hidden gap-3 lg:grid lg:grid-cols-3 xl:grid-cols-6">
              <Stat label="Urgentes" value={t.urgente} tone={t.urgente ? "text-red-400" : undefined} href={`${base}/ocorrencias?status=URGENTE`} />
              <Stat label="Bloqueios" value={t.bloqueio} tone={t.bloqueio ? "text-purple-300" : undefined} href={`${base}/ocorrencias?status=BLOQUEIO`} />
              <Stat label="Pendentes" value={t.pendente} href={`${base}/ocorrencias?status=PENDENTE`} />
              <Stat label="Em andamento" value={t.emAndamento} href={`${base}/ocorrencias?status=EM_ANDAMENTO`} />
              <Stat label="Concluídas" value={t.concluido} href={`${base}/ocorrencias?status=CONCLUIDO`} />
              <Stat label="Total" value={t.total} href={`${base}/ocorrencias?filtro=todas`} />
            </div>

            {dash.mine.length > 0 && <Mine rows={dash.mine} eventId={eventId} />}

            {teams.length > 0 && (
              <Panel title={`Progresso ${scopeLabel}`}>
                <div className="space-y-1">
                  {teams.map((r, i) => (
                    <ProgressRow key={r.id} label={r.name} done={r.total - r.open} total={r.total} hint={`${r.open} ${r.open === 1 ? "aberto" : "abertos"} de ${r.total}`} i={i} />
                  ))}
                </div>
              </Panel>
            )}

            {t.total === 0 ? (
              <EmptyState title="Nenhuma ocorrência ainda">Use o botão + para abrir a primeira.</EmptyState>
            ) : (
              <section>
                <div className="mb-2 flex items-center justify-between px-1">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Quadro de chamados</h2>
                  <Link href={`${base}/ocorrencias?filtro=todas`} className="text-sm font-semibold text-primary">Ver todos ›</Link>
                </div>
                {/* Celular: colunas lado a lado, arrastando; computador: as quatro juntas. */}
                <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:grid lg:grid-cols-2 lg:overflow-visible lg:px-0 xl:grid-cols-4">
                  {dash.board.map((col, ci) => (
                    <div key={col.key} className="w-[78%] shrink-0 snap-start rounded-2xl border border-border bg-surface/60 p-3 sm:w-[45%] lg:w-auto">
                      <Link href={`${base}/ocorrencias?${col.filter}`} className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{col.label}</span>
                        <span className={cx("rounded-full px-2 py-0.5 text-xs font-bold text-brand-navy", serie(ci).bg)}>{col.count}</span>
                      </Link>
                      <div className="space-y-2">
                        {col.rows.length === 0 && <p className="py-3 text-center text-sm text-muted">Nenhum</p>}
                        {col.rows.map((o) => (
                          <Link key={o.id} href={`${base}/ocorrencias/${o.id}`} className="block rounded-xl border border-border bg-background/60 p-3 transition hover:border-primary/60">
                            <p className="line-clamp-2 text-sm font-semibold leading-snug">
                              <span className="mr-1 font-mono text-xs text-muted">#{o.number}</span>{o.title}
                            </p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                              {o.team && <span>{o.team.name}</span>}
                              <PriorityText priority={o.priority} />
                              <SlaPill dueAt={o.slaDueAt} closed={o.status === "CONCLUIDO"} />
                            </div>
                            {o.responsible && <p className="mt-1 truncate text-xs text-muted">Com {o.responsible.name}</p>}
                          </Link>
                        ))}
                        {col.count > col.rows.length && (
                          <Link href={`${base}/ocorrencias?${col.filter}`} className="block py-1 text-center text-xs font-semibold text-primary">
                            + {col.count - col.rows.length} {col.count - col.rows.length === 1 ? "outro" : "outros"}
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside className="mt-4 space-y-4 lg:mt-0">
            <Panel className="hidden lg:block"><Profile name={actor.name} role={role} detail={event.name} /></Panel>
            {agenda.length > 0 && (
              <Panel title="Minha agenda" action={<Link href={`${base}/briefing`} className="text-sm font-semibold text-primary">Ver ›</Link>}>
                <ul className="space-y-2">
                  {agenda.map((a, i) => (
                    <li key={a.id} className="flex items-center gap-3">
                      <span className={cx("h-9 w-1 shrink-0 rounded-full", serie(i).bg)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{a.title}</span>
                        <span className="block truncate text-xs text-muted">{[a.day && formatDay(a.day), a.startTime && `${a.startTime}${a.endTime ? `–${a.endTime}` : ""}`, a.place].filter(Boolean).join(" · ") || "Sem horário"}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
            <Panel title="SLA">
              <div className="grid grid-cols-3 gap-2">
                <Ring value={dash.sla.concluded ? pct(dash.sla.onTime, dash.sla.concluded) : null} label="No prazo" i={0} />
                <Ring value={t.total ? pct(t.total - open, t.total) : null} label="Resolvidos" i={1} />
                <div className="flex flex-col items-center justify-center text-center">
                  <span className={cx("text-2xl font-bold tabular-nums", dash.sla.breachedOpen ? "text-red-400" : undefined)}>{dash.sla.breachedOpen}</span>
                  <span className="text-xs text-muted">Atrasados abertos</span>
                </div>
              </div>
              <p className="mt-3 text-center text-sm text-muted">Tempo médio: <strong className="text-foreground">{formatDuration(dash.sla.avgSeconds)}</strong></p>
            </Panel>
            {dash.byArea.length > 1 && (
              <Panel title="Resolvidos por área">
                <div className="grid grid-cols-3 gap-2">
                  {dash.byArea.slice(0, 6).map((r, i) => <Ring key={r.id} value={pct(r.total - r.open, r.total)} label={r.name} i={i} size={56} />)}
                </div>
              </Panel>
            )}
            {teams.some((r) => r.total - r.open > 0) && (
              <Panel title="Concluídos por equipe">
                <Bars rows={teams.map((r) => ({ label: r.name, value: r.total - r.open }))} />
              </Panel>
            )}
          </aside>
        </div>
      </main>
    </>
  );
}

function Mine({ rows, eventId }: { rows: OccurrenceRow[]; eventId: string }) {
  return (
    <section>
      <SectionTitle>Comigo agora</SectionTitle>
      <div className="grid gap-3 xl:grid-cols-2">
        {rows.map((o) => <OccurrenceCard key={o.id} o={o} eventId={eventId} />)}
      </div>
    </section>
  );
}

/** "2027-04-10" → "10/04". */
function formatDay(day: string) {
  const [, m, d] = day.split("-");
  return `${d}/${m}`;
}
