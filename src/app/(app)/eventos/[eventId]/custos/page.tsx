import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { clientCan } from "@/server/authz/policy";
import { getEvent } from "@/modules/events/events.service";
import { getClientCosts } from "@/modules/costs/costs.service";
import { TopBar } from "@/components/top-bar";
import { Card, EmptyState, PAGE, buttonClass, cx } from "@/components/ui";
import { brl } from "@/lib/money";

export const metadata = { title: "Custos" };

const pct = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const num = (n: number | null) => (n === null ? "" : n.toLocaleString("pt-BR", { maximumFractionDigits: 2 }));

/** Custos para o Cliente: a planilha do evento, só para ler (quando o Gerente libera). */
export default async function ClientCostsPage({ params }: PageProps<"/eventos/[eventId]/custos">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!clientCan(actor, eventId, "costs")) notFound();
  const [event, sheet] = await Promise.all([getEvent(actor, eventId), getClientCosts(actor, eventId)]);
  const t = sheet.totals;
  const r = sheet.rates;
  const highlights: [string, number][] = [
    ["Fornecedores", t.suppliers],
    [`Honorários (${pct(r.feePct)})`, t.fee],
    ["Total fatura", t.invoiceTotal],
    ["Total nota fiscal", t.nfTotal],
  ];

  return (
    <>
      <TopBar title="Custos" subtitle={`${event.name} · só leitura`} back={`/eventos/${eventId}`} />
      <main className={cx(PAGE, "flex flex-col gap-4 py-4 lg:py-6")}>
        {sheet.itemCount === 0 ? (
          <EmptyState title="A planilha de custos ainda está vazia">Quando a equipe preencher, ela aparece aqui.</EmptyState>
        ) : (
          <>
            <Card>
              <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
                <div>
                  <p className="text-sm text-muted">Total geral</p>
                  <p className="mt-1 text-3xl font-bold tabular-nums">{brl(t.total)}</p>
                </div>
                <dl className="grid w-full grid-cols-2 gap-x-6 gap-y-3 text-sm sm:w-auto sm:min-w-0 sm:flex-1 sm:grid-cols-4">
                  {highlights.map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-muted">{label}</dt>
                      <dd className="font-semibold tabular-nums">{brl(value)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                <p className="text-sm text-muted">
                  {[sheet.header.projectName, sheet.header.period].filter(Boolean).join(" · ") || "Orçamento do evento"}
                </p>
                <a href={`/api/events/${eventId}/costs/export`} download className={buttonClass("secondary", "min-h-11 text-sm")}>Baixar Excel</a>
              </div>
            </Card>

            {sheet.sections.map((s, si) => (
              <section key={s.id} aria-label={s.name}>
                <div className="flex items-center gap-3 rounded-t-2xl border border-b-0 border-border bg-white/5 px-4 py-2.5">
                  <h2 className="min-w-0 flex-1 font-semibold uppercase tracking-wide"><span className="mr-2 text-muted">{si + 1}</span>{s.name}</h2>
                  <span className="font-semibold tabular-nums">{brl(s.total)}</span>
                </div>
                <div className="rounded-b-2xl border border-border">
                  {/* Computador: tabela. */}
                  <table className="hidden w-full table-fixed text-left text-sm lg:table">
                    <thead className="text-xs uppercase tracking-wide text-muted">
                      <tr>
                        <th className="w-14 px-4 py-2 font-semibold">#</th>
                        <th className="px-4 py-2 font-semibold">Item</th>
                        <th className="w-36 px-4 py-2 text-right font-semibold">Valor unitário</th>
                        <th className="w-20 px-4 py-2 text-right font-semibold">Qtd</th>
                        <th className="w-20 px-4 py-2 text-right font-semibold">Freq.</th>
                        <th className="w-36 px-4 py-2 text-right font-semibold">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border border-t border-border">
                      {s.items.map((it, ii) => (
                        <tr key={it.id} className="align-top">
                          <td className="px-4 py-2.5 text-muted tabular-nums">{si + 1}.{ii + 1}</td>
                          <td className="px-4 py-2.5">
                            <p className="font-medium">{it.name}</p>
                            {it.description && <p className="whitespace-pre-line text-muted">{it.description}</p>}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{it.unitValue === null ? <span className="text-amber-300">a definir</span> : brl(it.unitValue)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{num(it.quantity)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{num(it.frequency)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{it.optional ? <span className="text-muted">Opcional</span> : it.subtotal === null ? "" : brl(it.subtotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {/* Celular: lista. */}
                  <ul className="divide-y divide-border lg:hidden">
                    {s.items.map((it, ii) => (
                      <li key={it.id} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <p className="min-w-0 font-medium"><span className="mr-1 text-muted">{si + 1}.{ii + 1}</span>{it.name}</p>
                          <p className="shrink-0 font-semibold tabular-nums">{it.optional ? <span className="text-muted">Opcional</span> : it.subtotal === null ? <span className="text-amber-300">a definir</span> : brl(it.subtotal)}</p>
                        </div>
                        {it.description && <p className="mt-0.5 line-clamp-3 whitespace-pre-line text-sm text-muted">{it.description}</p>}
                        <p className="mt-1 text-xs text-muted tabular-nums">
                          {it.unitValue === null ? "Valor a definir" : brl(it.unitValue)} × {num(it.quantity)}{it.frequency !== null ? ` × ${num(it.frequency)}` : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            ))}
          </>
        )}
      </main>
    </>
  );
}
