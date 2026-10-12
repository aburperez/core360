import type { Actor } from "@/server/authz/actor";
import { COMPARE_MAX, eventComparison } from "@/modules/intelligence/intelligence.service";
import { EVENT_STATUS_LABEL } from "@/lib/event-stages";
import { brl, decimal } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { Select } from "@/components/field";
import { Panel, serie } from "@/components/panel";
import { EmptyState, cx } from "@/components/ui";
import { categoryLabel, type HiddenValues } from "./shared";

const money = (v: number | null) => (v === null ? "—" : brl(v));
const pctText = (v: number) => `${decimal(Math.round(v * 10) / 10)}%`;

/** Os eventos lado a lado: os 4 valores, o custo por pessoa e as categorias. */
export async function CompareTab({ actor, agencyId, client, events, hidden }: { actor: Actor; agencyId: string; client?: string; events: string[]; hidden: HiddenValues }) {
  const r = await eventComparison(actor, agencyId, { client, events });
  const cats = r.categories.map((c) => c.category ?? "");
  return (
    <>
      <p className="text-sm text-muted">
        Custo do evento = o realizado de cada item; sem realizado, o contratado. Por pessoa usa o público previsto da ficha do evento.
        Os encerrados e excluídos entram pelo resumo guardado.
      </p>
      {r.events.length === 0 ? (
        <EmptyState title="Nenhum evento com valores ainda">O comparativo aparece quando os eventos têm itens no Orçamento.</EmptyState>
      ) : (
        <form method="get" className="space-y-4">
          {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-border bg-surface p-3">
            <label className="block min-w-48 flex-1 sm:flex-none">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Cliente</span>
              <Select name="cliente" defaultValue={r.client ?? ""} className="min-h-10 py-1.5">
                <option value="">Todos</option>
                {r.clients.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </label>
            <button type="submit" className="min-h-10 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">Comparar</button>
            <p className="w-full text-xs text-muted sm:ml-2 sm:w-auto">Marque até {COMPARE_MAX} eventos na lista e toque em Comparar.</p>
          </div>

          <section className="rounded-2xl border border-border bg-surface" aria-label="Eventos">
            <h2 className="border-b border-border px-4 py-3 text-sm font-semibold uppercase tracking-wide text-muted">Eventos ({r.events.length})</h2>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th scope="col" className="w-10 px-3 py-2"><span className="sr-only">Comparar</span></th>
                    {["Evento", "Estimado", "Cotado", "Contratado", "Realizado", "Custo", "Público", "Por pessoa"].map((h, k) => (
                      <th key={h} scope="col" className={cx("px-3 py-2 font-semibold", k >= 1 && "text-right")}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {r.events.map((e) => (
                    <tr key={e.id} className={cx("align-top", e.selected && "bg-brand-cyan/5")}>
                      <td className="px-3 py-2.5"><input type="checkbox" name="ev" value={e.id} defaultChecked={e.selected} aria-label={`Comparar ${e.name}`} className="h-4 w-4 accent-[var(--color-primary)]" /></td>
                      <td className="px-3 py-2.5">
                        <p className="font-medium">{e.name}</p>
                        <p className="text-xs text-muted">{e.client} · {formatDate(e.startsAt)} · {e.archived ? "Encerrado" : EVENT_STATUS_LABEL[e.status] ?? e.status}</p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{brl(e.totals.estimated)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{brl(e.totals.quoted)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{brl(e.totals.contracted)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{brl(e.totals.actual)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums">{brl(e.cost)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{e.audience ? decimal(e.audience) : "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-brand-cyan">{money(e.perPerson)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-border lg:hidden">
              {r.events.map((e) => (
                <li key={e.id} className={cx(e.selected && "bg-brand-cyan/5")}>
                  <label className="flex items-start gap-3 px-4 py-3">
                    <input type="checkbox" name="ev" value={e.id} defaultChecked={e.selected} className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-primary)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{e.name}</span>
                      <span className="block text-xs text-muted">{e.client} · {formatDate(e.startsAt)}{e.archived ? " · Encerrado" : ""}</span>
                      <span className="mt-1 grid grid-cols-2 gap-x-4 text-xs">
                        <span className="text-muted">Contratado</span><span className="text-right tabular-nums">{brl(e.totals.contracted)}</span>
                        <span className="text-muted">Realizado</span><span className="text-right tabular-nums">{brl(e.totals.actual)}</span>
                        <span className="text-muted">Custo</span><span className="text-right font-semibold tabular-nums">{brl(e.cost)}</span>
                        <span className="text-muted">Por pessoa</span><span className="text-right font-semibold tabular-nums text-brand-cyan">{money(e.perPerson)}</span>
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex justify-end border-t border-border px-4 py-3">
              <button type="submit" className="min-h-10 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">Comparar os marcados</button>
            </div>
          </section>

          {r.compared.length > 0 && (
            <Panel title="Lado a lado, por categoria">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-muted">
                    <tr className="border-b border-border">
                      <th scope="col" className="py-2 pr-3 font-semibold">Categoria</th>
                      {r.compared.map((e, k) => (
                        <th key={e.id} scope="col" className="px-3 py-2 text-right font-semibold normal-case tracking-normal">
                          <span className={cx("block truncate text-sm", serie(k).text)}>{e.name}</span>
                          <span className="block text-xs font-normal">{formatDate(e.startsAt)}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {cats.filter((c) => r.compared.some((e) => e.byCategory[c])).map((c) => (
                      <tr key={c || "none"}>
                        <th scope="row" className="py-2 pr-3 font-medium">{categoryLabel(c as never)}</th>
                        {r.compared.map((e) => {
                          const v = e.byCategory[c] ?? 0;
                          return (
                            <td key={e.id} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                              {v ? <>{brl(v)}<span className="block text-xs text-muted">{e.cost ? pctText((v / e.cost) * 100) : ""}</span></> : <span className="text-muted">—</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-border font-semibold">
                    <tr>
                      <th scope="row" className="py-2 pr-3">Custo do evento</th>
                      {r.compared.map((e) => <td key={e.id} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{brl(e.cost)}</td>)}
                    </tr>
                    <tr>
                      <th scope="row" className="py-2 pr-3">Por pessoa</th>
                      {r.compared.map((e) => (
                        <td key={e.id} className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-brand-cyan">
                          {money(e.perPerson)}
                          {e.audience ? <span className="block text-xs font-normal text-muted">{decimal(e.audience)} pessoas</span> : <span className="block text-xs font-normal text-muted">sem público na ficha</span>}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Panel>
          )}

          <Panel title="Quanto custa cada categoria">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
                  <tr>
                    {["Categoria", "Eventos", "Menor", "Média", "Maior", "Média por pessoa", "% do evento"].map((h, k) => (
                      <th key={h} scope="col" className={cx("py-2 font-semibold", k === 0 ? "pr-3" : "px-3 text-right")}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {r.categories.map((c) => (
                    <tr key={c.category ?? "none"}>
                      <th scope="row" className="py-2 pr-3 font-medium">{categoryLabel(c.category)}</th>
                      <td className="px-3 py-2 text-right tabular-nums">{c.cost!.n}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{brl(c.cost!.min)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{brl(c.cost!.avg)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{brl(c.cost!.max)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-brand-cyan">{c.perPerson ? brl(c.perPerson.avg) : "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{c.share ? pctText(c.share.avg) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {r.perPersonAll && (
              <p className="mt-3 text-xs text-muted">
                Custo por pessoa nos {r.perPersonAll.n} eventos com público na ficha: menor {brl(r.perPersonAll.min)}, média {brl(r.perPersonAll.avg)}, maior {brl(r.perPersonAll.max)}.
              </p>
            )}
          </Panel>
        </form>
      )}
    </>
  );
}
