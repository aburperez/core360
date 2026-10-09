import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUsePreProduction } from "@/server/authz/policy";
import { listPendencies, type Pendency } from "@/modules/pendencies/pendencies.service";
import { GROUPS, KIND_LABEL } from "@/modules/pendencies/pendency-meta";
import { dayText, weekday } from "@/modules/schedule/schedule-meta";
import { TopBar } from "@/components/top-bar";
import { PageHeading, Panel } from "@/components/panel";
import { PAGE, cx } from "@/components/ui";
import { DoneToggle } from "../cronograma/forms";
import { Filters, NewTask, TaskActions } from "./forms";

export const metadata = { title: "Pendências" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

/**
 * Central de pendências: o que falta no evento, em Atrasado, Vence hoje,
 * Próximos 7 dias e Sem data. O atrasado é crítico (vermelho, no topo e no
 * painel). Só a Pré-produção.
 */
export default async function PendenciesPage({ params, searchParams }: PageProps<"/eventos/[eventId]/pre-producao/pendencias">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!canUsePreProduction(actor, eventId)) notFound();
  const q = await searchParams;
  const data = await listPendencies(actor, eventId, { areaId: one(q.area), responsibleId: one(q.responsavel) });
  const filtered = !!(data.filters.areaId || data.filters.responsibleId);
  const base = `/eventos/${eventId}/pre-producao`;
  const t = data.totals;
  const stats = [
    { label: "Atrasado", value: t.late, tone: t.late ? "border-red-500/40 bg-red-500/10 text-red-300" : "border-border bg-surface text-emerald-300" },
    { label: "Vence hoje", value: t.today, tone: t.today ? "border-amber-400/40 bg-amber-400/10 text-amber-200" : "border-border bg-surface" },
    { label: "Próximos 7 dias", value: t.week, tone: "border-border bg-surface" },
    { label: "Sem data", value: t.undated, tone: "border-border bg-surface" },
  ];

  return (
    <>
      <TopBar title="Pendências" subtitle={data.eventName} back={base} />
      <main className={cx(PAGE, "space-y-4 py-4 lg:py-6")}>
        <PageHeading trail={[data.eventName, "Pré-produção"]} title="Central de pendências">
          <NewTask eventId={eventId} areas={data.areas} people={data.people} />
        </PageHeading>
        <p className="text-sm text-muted">
          Tudo que falta no evento, numa lista só: marcos do cronograma, itens com prazo, itens do mapa de montagem ainda não montados, cotações, contratos, avaliações
          de fornecedores no Fechamento e as pendências criadas aqui. O que está atrasado é crítico. O campo e o cliente não veem.
        </p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className={cx("rounded-2xl border p-3", s.tone)}>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{s.label}</p>
              <p className="text-2xl font-bold tabular-nums">{s.value}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <Filters areas={data.areas} people={data.people} areaId={data.filters.areaId} responsibleId={data.filters.responsibleId} />
          <div className="lg:hidden"><NewTask eventId={eventId} areas={data.areas} people={data.people} /></div>
        </div>
        {filtered && <p className="text-sm text-muted">Mostrando {data.items.length} com o filtro. Pendências sem área ou sem responsável não aparecem no filtro.</p>}

        {GROUPS.map((g) => {
          const rows = data.items.filter((p) => p.group === g.key);
          if (g.key === "SEM_DATA" && rows.length === 0) return null;
          const late = g.key === "ATRASADO";
          return (
            <Panel key={g.key} title={`${g.title} (${rows.length})`} className={cx(late && rows.length > 0 && "border-red-500/40 bg-red-500/5")}>
              {rows.length === 0 ? (
                <p className={cx("text-sm", late ? "text-emerald-300" : "text-muted")}>{g.empty}</p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {rows.map((p) => <Row key={p.key} p={p} areas={data.areas} people={data.people} />)}
                </ul>
              )}
            </Panel>
          );
        })}

        {t.later > 0 && (
          <p className="text-sm text-muted">
            Mais {t.later} {t.later === 1 ? "pendência" : "pendências"} com prazo depois de 7 dias. Veja as datas no{" "}
            <Link href={`${base}/cronograma`} className="text-primary underline">Cronograma</Link>.
          </p>
        )}
      </main>
    </>
  );
}

type Option = { id: string; name: string };

function Row({ p, areas, people }: { p: Pendency; areas: Option[]; people: Option[] }) {
  const late = p.group === "ATRASADO";
  const meta = [p.area?.name, p.responsible?.name ?? (p.kind === "MANUAL" || p.kind === "MARCO" ? "Sem responsável" : null)].filter(Boolean).join(" · ");
  const title = p.href ? (
    <Link href={p.href} className="font-semibold text-foreground hover:text-primary hover:underline">{p.title}</Link>
  ) : (
    <p className="font-semibold">{p.title}</p>
  );
  return (
    <li className="flex items-start gap-3 py-3">
      {p.toggle ? (
        <DoneToggle id={p.id} done={false} title={p.title} path={p.kind === "MANUAL" ? `/api/tasks/${p.id}/done` : `/api/milestones/${p.id}/done`} />
      ) : (
        <span className={cx("mt-1.5 h-3 w-3 shrink-0 rounded-full", late ? "bg-red-400" : p.group === "HOJE" ? "bg-amber-300" : "bg-white/25")} aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1 sm:flex sm:items-start sm:gap-3">
        <div className="min-w-0 sm:flex-1">
          {title}
          {p.detail && <p className="text-sm text-muted">{p.detail}</p>}
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-bold text-foreground">{KIND_LABEL[p.kind]}</span>
            {meta && <span>{meta}</span>}
          </p>
        </div>
        <div className="mt-1 flex items-center gap-2 sm:mt-0 sm:shrink-0 sm:flex-col sm:items-end sm:gap-1">
          {p.dueOn && (
            <span className={cx("text-sm font-semibold tabular-nums", late ? "text-red-300" : "text-foreground")}>
              {weekday(p.dueOn)} {dayText(p.dueOn)}
            </span>
          )}
          {late && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-bold text-red-300">{p.lateDays ? `${p.lateDays} ${p.lateDays === 1 ? "dia" : "dias"} de atraso` : "Prazo passou"}</span>}
          {p.kind === "MANUAL" && (
            <TaskActions task={{ id: p.id, title: p.title, dueOn: p.dueOn, areaId: p.area?.id ?? null, responsibleId: p.responsible?.id ?? null }} areas={areas} people={people} />
          )}
          {p.href && <Link href={p.href} className="text-sm font-semibold text-primary">Abrir ›</Link>}
        </div>
      </div>
    </li>
  );
}
