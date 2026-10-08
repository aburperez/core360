import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUsePreProduction } from "@/server/authz/policy";
import { getSchedule } from "@/modules/schedule/schedule.service";
import { DUE_STATE, dayText, weekday } from "@/modules/schedule/schedule-meta";
import { ITEM_STATUS_LABEL } from "@/modules/items/item-meta";
import { TopBar } from "@/components/top-bar";
import { PageHeading, Panel } from "@/components/panel";
import { EmptyState, PAGE, cx } from "@/components/ui";
import { DefaultMilestones, DoneToggle, MilestoneActions, NewMilestone } from "./forms";

export const metadata = { title: "Cronograma" };

/**
 * Cronograma do evento: os marcos de T-30 a T0 com responsável e feito, e os
 * itens com prazo (e de quem dependem). Só a Pré-produção.
 */
export default async function SchedulePage({ params }: PageProps<"/eventos/[eventId]/pre-producao/cronograma">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!canUsePreProduction(actor, eventId)) notFound();
  const s = await getSchedule(actor, eventId);
  const items = `/eventos/${eventId}/pre-producao/itens`;
  // Onde entra a linha "Hoje" na lista de marcos.
  const todayAt = s.milestones.findIndex((m) => m.dueOn >= s.today);
  const todayLine = (
    <li key="hoje" className="flex items-center gap-3 py-1" aria-label="Hoje">
      <span className="w-16 shrink-0 text-right text-xs font-bold text-brand-cyan">{s.todayT}</span>
      <span className="h-px flex-1 bg-brand-cyan/60" />
      <span className="text-xs font-bold uppercase tracking-wide text-brand-cyan">Hoje · {dayText(s.today)}</span>
    </li>
  );

  return (
    <>
      <TopBar title="Cronograma" subtitle={s.eventName} back={`/eventos/${eventId}/pre-producao`} />
      <main className={cx(PAGE, "space-y-4 py-4 lg:py-6")}>
        <PageHeading trail={[s.eventName, "Pré-produção"]} title="Cronograma">
          <span className="rounded-full bg-brand-cyan/15 px-3 py-1 text-sm font-semibold text-brand-cyan">Hoje é {s.todayT}</span>
        </PageHeading>
        <p className="text-sm text-muted">
          Os marcos contam do primeiro dia do evento ({dayText(s.eventDay, true)}, o T0). O app cria os marcos padrão; mude a data, o nome ou o
          responsável e crie os que faltarem. O campo e o cliente não veem.
        </p>

        {s.milestones.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-border bg-surface p-4 sm:col-span-2">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-semibold uppercase tracking-wide text-muted">Marcos feitos</p>
                <p className="text-2xl font-bold tabular-nums">{s.progress.pct}%</p>
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-emerald-400" style={{ width: `${s.progress.pct}%` }} />
              </div>
              <p className="mt-2 text-sm text-muted">{s.progress.done} de {s.progress.total} marcos</p>
            </div>
            <div className={cx("rounded-2xl border p-4", s.late ? "border-red-500/40 bg-red-500/10" : "border-border bg-surface")}>
              <p className="text-sm font-semibold uppercase tracking-wide text-muted">Atrasados</p>
              <p className={cx("text-2xl font-bold tabular-nums", s.late ? "text-red-300" : "text-emerald-300")}>{s.late}</p>
              <p className="text-sm text-muted">{s.late ? "marcos e itens com prazo vencido" : "Nada atrasado"}</p>
            </div>
          </div>
        )}

        <Panel title="Marcos" action={s.milestones.length > 0 && <NewMilestone eventId={eventId} people={s.people} defaultDay={s.today} />}>
          {s.milestones.length === 0 ? (
            <EmptyState title="Este evento ainda não tem marcos">
              <p className="mb-3">Crie os marcos padrão, de T-30 (orçamento fechado) até T0 (dia do evento), e ajuste depois.</p>
              <div className="flex flex-wrap justify-center gap-2">
                <DefaultMilestones eventId={eventId} />
                <NewMilestone eventId={eventId} people={s.people} defaultDay={s.today} />
              </div>
            </EmptyState>
          ) : (
            <ol className="space-y-1">
              {s.milestones.map((m, i) => {
                const st = DUE_STATE[m.state];
                return (
                  <Fragment key={m.id}>
                    {i === todayAt && todayLine}
                    <li className={cx("flex items-start gap-3 rounded-xl px-1 py-2.5", m.state === "ATRASADO" && "bg-red-500/5")}>
                      <div className="w-14 shrink-0 text-right sm:w-16">
                        <p className={cx("font-bold tabular-nums", m.state === "ATRASADO" ? "text-red-300" : "text-foreground")}>{m.t}</p>
                        <p className="text-xs text-muted tabular-nums">{weekday(m.dueOn)} {dayText(m.dueOn)}</p>
                      </div>
                      <DoneToggle id={m.id} done={m.state === "FEITO"} title={m.title} />
                      {/* Celular: status e Mudar embaixo do nome. Computador: à direita. */}
                      <div className="min-w-0 flex-1 sm:flex sm:items-start sm:gap-3">
                        <div className="min-w-0 sm:flex-1">
                          <p className={cx("font-semibold", m.state === "FEITO" && "text-muted line-through")}>{m.title}</p>
                          <p className="text-sm text-muted">
                            {m.responsible ?? "Sem responsável"}
                            {m.state === "FEITO" && m.doneBy && ` · feito por ${m.doneBy}`}
                          </p>
                        </div>
                        <div className="mt-1 flex items-center gap-2 sm:mt-0 sm:shrink-0">
                          <span className={cx("rounded-full px-2 py-0.5 text-xs font-bold", st.tone)}>{st.label}</span>
                          <MilestoneActions milestone={m} people={s.people} />
                        </div>
                      </div>
                    </li>
                  </Fragment>
                );
              })}
              {todayAt === -1 && todayLine}
            </ol>
          )}
        </Panel>

        <Panel title={`Itens com prazo (${s.items.length})`}>
          {s.items.length === 0 ? (
            <p className="text-sm text-muted">
              Nenhum item com prazo ainda. O prazo e o &quot;Depende de&quot; ficam na tela de cada item, no <Link href={items} className="text-primary underline">Mapa de itens</Link>.
            </p>
          ) : (
            <>
              <ul className="divide-y divide-border/60">
                {s.items.map((it) => {
                  const st = it.state && (it.state === "FEITO" ? { label: "Pronto", tone: DUE_STATE.FEITO.tone } : DUE_STATE[it.state]);
                  return (
                    <li key={it.id} className="flex items-start gap-3 py-2.5">
                      <div className="w-14 shrink-0 text-right sm:w-16">
                        <p className={cx("font-bold tabular-nums", it.state === "ATRASADO" ? "text-red-300" : "text-foreground")}>{it.t ?? "—"}</p>
                        {it.dueOn && <p className="text-xs text-muted tabular-nums">{weekday(it.dueOn)} {dayText(it.dueOn)}</p>}
                      </div>
                      <div className="min-w-0 flex-1 sm:flex sm:items-start sm:gap-3">
                      <div className="min-w-0 sm:flex-1">
                        <Link href={`${items}/${it.id}`} className="font-semibold text-primary hover:underline">
                          <span className="mr-2 text-sm text-muted tabular-nums">{it.code}</span>{it.name}
                        </Link>
                        <p className="text-sm text-muted">
                          {[ITEM_STATUS_LABEL[it.status], it.area, it.responsible ?? "Sem responsável"].filter(Boolean).join(" · ")}
                        </p>
                        {it.dependsOn && (
                          <p className={cx("text-sm", it.waiting ? "text-amber-200" : "text-muted")}>
                            {it.waiting ? "Aguardando" : "Depende de"}{" "}
                            <Link href={`${items}/${it.dependsOn.id}`} className="underline">{it.dependsOn.code} {it.dependsOn.name}</Link>
                            {it.dependsOn.ready && " (pronto)"}
                          </p>
                        )}
                        {it.dependencyLate && (
                          <p className="text-sm text-red-300">O prazo de {it.dependsOn!.code} ({dayText(it.dependsOn!.neededOn!)}) é depois do prazo deste item.</p>
                        )}
                      </div>
                      {st && <span className={cx("mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-bold sm:mt-0 sm:shrink-0", st.tone)}>{st.label}</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-xs text-muted">O item conta como feito quando chega em Pronto. O prazo e o &quot;Depende de&quot; ficam na tela do item.</p>
            </>
          )}
        </Panel>
      </main>
    </>
  );
}
