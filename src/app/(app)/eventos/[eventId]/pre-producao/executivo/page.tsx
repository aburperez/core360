import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canReviewSla, canUseField, canUsePreProduction } from "@/server/authz/policy";
import { getEvent } from "@/modules/events/events.service";
import { getExecutivePanel } from "@/modules/panels/panels.service";
import { CATEGORY, type ItemCategory } from "@/modules/items/item-meta";
import { brl } from "@/lib/money";
import { TopBar } from "@/components/top-bar";
import { EventTabs } from "@/components/event-nav";
import { PageHeading, Panel, Ring } from "@/components/panel";
import { PAGE, cx } from "@/components/ui";

export const metadata = { title: "Painel executivo" };

/**
 * Painel executivo (fase 6A): numa tela, quanto o evento custa nos 4 valores,
 * onde economizou ou estourou, o orçamento aprovado e os maiores riscos.
 * Só o diretor de produção; o serviço e a RLS repetem a regra.
 */
export default async function ExecutivePage({ params }: PageProps<"/eventos/[eventId]/pre-producao/executivo">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!canUsePreProduction(actor, eventId) || !canReviewSla(actor, eventId)) notFound();
  const [event, x] = await Promise.all([getEvent(actor, eventId), getExecutivePanel(actor, eventId)]);
  const t = x.totals;
  const base = `/eventos/${eventId}/pre-producao`;

  return (
    <>
      <TopBar title="Painel executivo" subtitle={event.name} back={base} />
      {canUseField(actor, eventId) && <EventTabs eventId={eventId} active="pre" />}
      <main className={cx(PAGE, "space-y-4 py-4 lg:py-6")}>
        <PageHeading trail={[event.name, "Pré-produção"]} title="Painel executivo" />
        <p className="-mt-2 text-sm text-muted">Só o diretor de produção vê esta tela.</p>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Os 4 valores">
          <Value label="Estimado" value={t.estimated} hint={`${t.items} itens na planilha`} />
          <Value label="Cotado" value={t.quoted} hint={`${t.withQuoted} de ${t.items} cotados`} />
          <Value label="Contratado" value={t.contracted} hint={`${t.withContracted} de ${t.items} contratados`} />
          <Value label="Realizado" value={t.actual} hint={`${t.withActual} de ${t.items} pagos`} />
        </section>

        <div className="grid gap-3 lg:grid-cols-3">
          <Result label={t.saving >= 0 ? "Economia" : "Contratou acima do estimado"} value={Math.abs(t.saving)} good={t.saving >= 0} hint="Estimado − Contratado" />
          <Result label={t.overrun > 0 ? "Estouro" : "Pagou abaixo do contratado"} value={Math.abs(t.overrun)} good={t.overrun <= 0} hint="Realizado − Contratado" />
          <Panel title="Orçamento aprovado">
            {x.approved.value === null ? (
              <p className="text-sm text-muted">Ainda não informado na <Link href={`/eventos/${eventId}/editar`} className="text-primary underline">ficha do evento</Link>.</p>
            ) : (
              <>
                <p className="text-2xl font-bold tabular-nums">{brl(x.approved.value)}</p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10" aria-hidden>
                  <div className={cx("h-full rounded-full", (x.approved.contractedPct ?? 0) > 100 ? "bg-red-400" : "bg-brand-cyan")} style={{ width: `${Math.min(100, x.approved.contractedPct ?? 0)}%` }} />
                </div>
                <p className="mt-1 text-sm text-muted">
                  {x.approved.contractedPct}% contratado · {x.approved.left! >= 0 ? `sobram ${brl(x.approved.left!)}` : `passou ${brl(-x.approved.left!)}`}
                </p>
              </>
            )}
          </Panel>
        </div>

        <div className="gap-4 space-y-4 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:space-y-0">
          <div className="min-w-0 space-y-4">
            <Panel title="Maiores riscos">
              {x.risks.length === 0 ? (
                <p className="text-sm text-emerald-300">Nada atrasado nem esperando decisão.</p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {x.risks.map((r) => (
                    <li key={r.text}>
                      <Link href={r.href} className="flex items-center justify-between gap-3 py-2.5 hover:text-primary">
                        <span className="flex min-w-0 items-center gap-3">
                          <span className={cx("h-2.5 w-2.5 shrink-0 rounded-full", r.tone === "red" ? "bg-red-500" : "bg-amber-400")} />
                          <span className="font-semibold">{r.text}</span>
                        </span>
                        <span className="shrink-0 text-sm text-primary">Abrir ›</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Por categoria" action={<Link href={`${base}/orcamento`} className="text-sm font-semibold text-primary">Orçamento ›</Link>}>
              <div className="-mx-4 overflow-x-auto px-4">
                <table className="w-full min-w-[34rem] text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="py-2 pr-3 font-semibold">Categoria</th>
                      <th className="py-2 pr-3 text-right font-semibold">Estimado</th>
                      <th className="py-2 pr-3 text-right font-semibold">Contratado</th>
                      <th className="py-2 pr-3 text-right font-semibold">Realizado</th>
                      <th className="py-2 text-right font-semibold">Economia / estouro</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {x.byCategory.map((g) => {
                      const diff = g.saving - g.overrun;
                      return (
                        <tr key={g.key ?? "none"}>
                          <td className="py-2 pr-3 font-semibold">{g.key ? CATEGORY[g.key as ItemCategory].label : "Sem categoria"}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{brl(g.estimated)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{g.withContracted ? brl(g.contracted) : "—"}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{g.withActual ? brl(g.actual) : "—"}</td>
                          <td className={cx("py-2 text-right font-semibold tabular-nums", diff > 0 ? "text-emerald-300" : diff < 0 ? "text-red-300" : "text-muted")}>
                            {diff === 0 ? "—" : `${diff > 0 ? "+" : "−"} ${brl(Math.abs(diff))}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted">Verde: economizou (contratou abaixo do estimado e pagou até o contratado). Vermelho: gastou mais. A conta usa só os itens que já têm os dois valores.</p>
            </Panel>
          </div>

          <aside className="space-y-4">
            <Panel title="Andamento">
              <div className="grid grid-cols-2 gap-2">
                <Ring value={x.schedule.total ? x.schedule.pct : null} label="Cronograma" i={1} />
                <Ring value={t.items ? Math.round((t.withContracted / t.items) * 100) : null} label="Contratado" i={0} />
              </div>
              <p className="mt-3 text-sm">
                <Link href={`${base}/pendencias`} className={cx("font-semibold hover:underline", x.pendencies.late ? "text-red-300" : "text-emerald-300")}>
                  {x.pendencies.late ? `${x.pendencies.late} pendências atrasadas` : "Nenhuma pendência atrasada"}
                </Link>
                <span className="text-muted"> · {x.pendencies.today} vencem hoje</span>
              </p>
            </Panel>
            <ItemList title="Maiores estouros" empty="Nenhum item pago acima do contratado." rows={x.overruns} base={base} />
            <ItemList title="Contratados acima do estimado" empty="Nenhum item contratado acima do estimado." rows={x.aboveEstimate} base={base} />
          </aside>
        </div>
      </main>
    </>
  );
}

function Value({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums lg:text-2xl">{brl(value)}</p>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>
    </div>
  );
}

function Result({ label, value, good, hint }: { label: string; value: number; good: boolean; hint: string }) {
  return (
    <div className={cx("rounded-2xl border p-4", good ? "border-emerald-500/30 bg-emerald-500/10" : "border-red-400/40 bg-red-500/10")}>
      <p className={cx("text-xs font-semibold uppercase tracking-wide", good ? "text-emerald-300" : "text-red-300")}>{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{brl(value)}</p>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>
    </div>
  );
}

function ItemList({ title, empty, rows, base }: { title: string; empty: string; rows: { id: string; code: string; name: string; value: number }[]; base: string }) {
  return (
    <Panel title={title}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3">
              <Link href={`${base}/itens/${r.id}`} className="min-w-0 hover:text-primary">
                <span className="block truncate font-semibold">{r.name}</span>
                <span className="block text-xs text-muted tabular-nums">{r.code}</span>
              </Link>
              <span className="shrink-0 font-semibold text-red-300 tabular-nums">+ {brl(r.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
