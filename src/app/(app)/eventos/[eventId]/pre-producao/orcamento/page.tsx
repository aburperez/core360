import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUseField, canUsePreProduction } from "@/server/authz/policy";
import { getEvent } from "@/modules/events/events.service";
import { getBudget } from "@/modules/items/budget.service";
import { CATEGORY, COST_CENTER_LABEL, type CostCenter, type ItemCategory } from "@/modules/items/item-meta";
import type { BudgetTotals } from "@/modules/items/budget";
import { brl } from "@/lib/money";
import { TopBar } from "@/components/top-bar";
import { EventTabs } from "@/components/event-nav";
import { PageHeading, Panel } from "@/components/panel";
import { EmptyState, LinkButton, PAGE, cx } from "@/components/ui";
import { BudgetItems } from "./budget-items";
import { BudgetTabs } from "./tabs";

export const metadata = { title: "Orçamento" };

/**
 * Orçamento com os 4 valores (Estimado, Cotado, Contratado, Realizado), o
 * saving, o estouro e o orçamento aprovado, por item, categoria e centro de custo.
 */
export default async function BudgetPage({ params }: PageProps<"/eventos/[eventId]/pre-producao/orcamento">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!canUsePreProduction(actor, eventId)) notFound();
  const [event, b] = await Promise.all([getEvent(actor, eventId), getBudget(actor, eventId)]);
  const t = b.totals;

  return (
    <>
      <TopBar title="Orçamento" subtitle={event.name} back={`/eventos/${eventId}/pre-producao`} />
      {canUseField(actor, eventId) && <EventTabs eventId={eventId} active="pre" />}
      <BudgetTabs eventId={eventId} active="orcamento" />
      <main className={cx(PAGE, "space-y-4 py-4 lg:py-6")}>
        <PageHeading trail={[event.name, "Pré-produção"]} title="Orçamento" />
        {b.items.length === 0 ? (
          <EmptyState title="Nenhum item ainda">
            Os itens nascem na planilha Padrão CORE 360. Monte ou importe a planilha e o orçamento aparece aqui.
            <div className="mt-3"><LinkButton href={`/eventos/${eventId}/pre-producao/custos`}>Abrir a planilha</LinkButton></div>
          </EmptyState>
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Os 4 valores">
              <Value label="Estimado" value={t.estimated} hint="O valor da planilha" />
              <Value label="Cotado" value={t.quoted} hint={`${t.withQuoted} de ${t.items} itens cotados`} />
              <Value label="Contratado" value={t.contracted} hint={`${t.withContracted} de ${t.items} itens`} />
              <Value label="Realizado" value={t.actual} hint={`${t.withActual} de ${t.items} itens pagos`} />
            </section>

            <div className="grid gap-3 lg:grid-cols-3">
              <Result
                label={t.saving >= 0 ? "Saving" : "Acima do estimado"}
                value={Math.abs(t.saving)}
                good={t.saving >= 0}
                hint="Estimado − Contratado, nos itens já contratados"
              />
              <Result
                label={t.overrun > 0 ? "Estouro" : "Abaixo do contratado"}
                value={Math.abs(t.overrun)}
                good={t.overrun <= 0}
                hint="Realizado − Contratado, nos itens já pagos"
              />
              <Panel title="Orçamento aprovado">
                {b.approved.value === null ? (
                  <p className="text-sm text-muted">
                    Ainda não informado. O diretor preenche na <Link href={`/eventos/${eventId}/editar`} className="text-primary underline">ficha do evento</Link>.
                  </p>
                ) : (
                  <>
                    <p className="text-2xl font-bold tabular-nums">{brl(b.approved.value)}</p>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10" aria-hidden>
                      <div
                        className={cx("h-full rounded-full", (b.approved.contractedPct ?? 0) > 100 ? "bg-red-400" : "bg-brand-cyan")}
                        style={{ width: `${Math.min(100, b.approved.contractedPct ?? 0)}%` }}
                      />
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      {b.approved.contractedPct}% já contratado · {b.approved.left! >= 0 ? `sobram ${brl(b.approved.left!)}` : `passou ${brl(-b.approved.left!)}`}
                    </p>
                  </>
                )}
              </Panel>
            </div>

            <BudgetItems items={b.items} eventId={eventId} director={b.can.director} />

            <div className="grid gap-4 lg:grid-cols-2">
              <GroupTable
                title="Por categoria"
                rows={b.byCategory.map((g) => ({ ...g, label: g.key ? CATEGORY[g.key as ItemCategory].label : "Sem categoria" }))}
              />
              <GroupTable
                title="Por centro de custo"
                rows={b.byCostCenter.map((g) => ({ ...g, label: g.key ? COST_CENTER_LABEL[g.key as CostCenter] : "Sem centro de custo" }))}
              />
            </div>
            <p className="text-xs text-muted">
              Valores dos fornecedores, sem honorários e encargos (esses estão na planilha). Itens opcionais ficam fora dos totais.
            </p>
          </>
        )}
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

function GroupTable({ title, rows }: { title: string; rows: (BudgetTotals & { label: string })[] }) {
  return (
    <Panel title={title}>
      <div className="-mx-4 overflow-x-auto px-4">
        <table className="w-full min-w-[30rem] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" className="py-1.5 pr-2 font-semibold"> </th>
              <th scope="col" className="py-1.5 pr-2 text-right font-semibold">Estimado</th>
              <th scope="col" className="py-1.5 pr-2 text-right font-semibold">Contratado</th>
              <th scope="col" className="py-1.5 pr-2 text-right font-semibold">Realizado</th>
              <th scope="col" className="py-1.5 text-right font-semibold">Saving</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="py-1.5 pr-2">{r.label}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{brl(r.estimated)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{r.withContracted ? brl(r.contracted) : "—"}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{r.withActual ? brl(r.actual) : "—"}</td>
                <td className={cx("py-1.5 text-right tabular-nums", r.saving < 0 && "text-red-300", r.saving > 0 && "text-emerald-300")}>
                  {r.withContracted ? brl(r.saving) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
