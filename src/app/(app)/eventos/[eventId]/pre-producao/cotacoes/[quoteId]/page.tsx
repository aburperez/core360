import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { NotFoundError } from "@/server/errors";
import { getQuote } from "@/modules/quotes/quotes.service";
import { TopBar } from "@/components/top-bar";
import { PageHeading, Panel } from "@/components/panel";
import { Card, PAGE, cx } from "@/components/ui";
import { formatDateTime, formatDuration, slaText } from "@/lib/format";
import { formatCnpj } from "@/lib/cnpj";
import { formatPhone } from "@/lib/phone";
import { brl } from "@/lib/money";
import { AddQuote, ChooseForm, EditRequestForm, EmailActions, QuoteActions, SendForm, SlaForm, StateButton } from "../forms";
import { RatingBadge } from "@/components/rating";
import { supplierEmail } from "../email-text";
import { STAGE } from "../stage";

export const metadata = { title: "Cotação" };

const PROPOSAL = {
  SOLICITADA: { label: "Solicitada", tone: "bg-white/10 text-muted" },
  RECEBIDA: { label: "Recebida", tone: "bg-sky-400/15 text-sky-200" },
  EM_NEGOCIACAO: { label: "Em negociação", tone: "bg-amber-400/15 text-amber-200" },
  APROVADA: { label: "Aprovada", tone: "bg-emerald-500/15 text-emerald-300" },
  RECUSADA: { label: "Recusada", tone: "bg-red-500/15 text-red-300" },
  CANCELADA: { label: "Cancelada", tone: "bg-white/10 text-muted line-through" },
} as const;

/**
 * Uma cotação: o descritivo para os fornecedores (copiar ou abrir no e-mail),
 * o envio e o prazo, os 3 orçamentos e o comparativo com a escolha do gestor.
 */
export default async function QuotePage({ params }: PageProps<"/eventos/[eventId]/pre-producao/cotacoes/[quoteId]">) {
  const actor = await requireUser();
  const { eventId, quoteId } = await params;
  const q = await getQuote(actor, quoteId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  if (q.eventId !== eventId) notFound();
  const st = STAGE[q.stage];
  const sla = q.dueAt ? slaText(q.dueAt) : null;
  const chosen = q.quotes.find((x) => x.id === q.chosenQuoteId) ?? null;
  const subject = `Cotação: ${q.title} · ${q.eventName}`;
  const emailText = supplierEmail({ title: q.title, briefing: q.briefing, eventName: q.eventName, sender: actor.name });
  const slots = [1, 2, 3];

  return (
    <>
      <TopBar title={q.title} subtitle="Cotação" back={`/eventos/${eventId}/pre-producao/cotacoes`} />
      <main className={cx(PAGE, "space-y-4 py-4 lg:py-6")}>
        <PageHeading trail={[q.eventName, "Pré-produção", "Cotações"]} title={q.title}>
          <span className={cx("rounded-full px-3 py-1 text-sm font-semibold", st.tone)}>{st.label}</span>
        </PageHeading>
        <span className={cx("inline-block rounded-full px-3 py-1 text-sm font-semibold lg:hidden", st.tone)}>{st.label}</span>

        <div className="gap-4 space-y-4 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:space-y-0">
          <Panel
            title="Descritivo para os fornecedores"
            action={q.can.edit && (
              <EditRequestForm
                id={q.id} people={q.people} costItems={q.costItems}
                initial={{ title: q.title, briefing: q.briefing, responsibleId: q.responsibleId, costItemId: q.costItemId }}
              />
            )}
          >
            <p className="whitespace-pre-wrap leading-relaxed">{q.briefing}</p>
            <div className="mt-4 rounded-xl border border-border bg-background/50 p-3">
              <p className="text-sm text-muted">
                Copie o texto ou abra o seu e-mail já preenchido. Ele pede ao fornecedor CNPJ, razão social, telefone, e-mail, responsável, valor e condição de pagamento.
              </p>
              <div className="mt-3"><EmailActions subject={subject} text={emailText} /></div>
            </div>
          </Panel>

          <div className="space-y-4">
            <Panel title="Andamento">
              <dl className="space-y-2 text-sm">
                <Row label="Quem cuida" value={q.responsible.name} />
                {q.costItem && <Row label="Item da planilha" value={q.costItem.label} />}
                <Row label="Enviada" value={q.sentAt ? formatDateTime(q.sentAt) : "Ainda não"} />
                <Row
                  label="Prazo"
                  value={q.dueAt ? `${formatDuration(q.slaMinutes! * 60)} · até ${formatDateTime(q.dueAt)}` : q.status === "ABERTA" ? "Depois do envio" : "Aguardando o gestor"}
                  tone={!q.dueAt && q.status === "ENVIADA" ? "text-amber-300" : undefined}
                />
                {sla && (q.stage === "NO_PRAZO" || q.stage === "ATRASADA") && (
                  <Row label="Situação" value={sla.text} tone={sla.tone === "late" ? "text-red-300" : "text-brand-cyan"} />
                )}
                {q.completedAt && (
                  <Row
                    label="3 orçamentos"
                    value={`${formatDateTime(q.completedAt)}${q.dueAt ? (q.completedAt <= q.dueAt ? " · no prazo" : " · com atraso") : ""}`}
                    tone={q.dueAt && q.completedAt > q.dueAt ? "text-red-300" : "text-emerald-300"}
                  />
                )}
                {q.slaSetBy && <Row label="Prazo definido por" value={q.slaSetBy.name} />}
              </dl>
              {q.can.send && <div className="mt-4 border-t border-border pt-4"><SendForm id={q.id} manager={q.can.manage} /></div>}
              {q.can.setSla && <div className="mt-4 border-t border-border pt-4"><SlaForm id={q.id} current={q.slaMinutes} /></div>}
            </Panel>
            {(q.can.cancel || q.can.reopen) && (
              <div className="flex justify-end">
                {q.can.reopen ? <StateButton id={q.id} action="REABRIR" /> : <StateButton id={q.id} action="CANCELAR" />}
              </div>
            )}
          </div>
        </div>

        {q.status === "FECHADA" && chosen && (
          <Card className="border-emerald-500/40 bg-emerald-500/10">
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-300">Orçamento escolhido</p>
            <p className="mt-1 text-xl font-bold">{chosen.companyName} · {brl(chosen.value ?? 0)}</p>
            {q.chosenReason && <p className="mt-1 text-sm">Motivo: {q.chosenReason}</p>}
            <p className="mt-1 text-sm text-muted">{q.closedBy?.name} · {formatDateTime(q.closedAt)}</p>
          </Card>
        )}

        <Panel title={`Orçamentos (${q.quotes.length} de 3)`}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {slots.map((pos) => {
              const x = q.quotes.find((y) => y.position === pos);
              const row = x && q.comparison.rows.find((r) => r.id === x.id);
              if (!x) {
                return q.can.addQuote && pos === q.quotes.length + 1 ? <AddQuote key={pos} requestId={q.id} suppliers={q.suppliers} aiReader={q.aiReader} /> : (
                  <div key={pos} className="flex min-h-40 items-center justify-center rounded-2xl border-2 border-dashed border-border/60 text-sm text-muted">
                    Orçamento {pos}
                  </div>
                );
              }
              return (
                <div
                  key={x.id}
                  className={cx(
                    "flex min-w-0 flex-col gap-3 rounded-2xl border bg-background/40 p-4",
                    x.id === q.chosenQuoteId ? "border-emerald-500/60" : row?.lowest && q.comparison.rows.length > 1 ? "border-brand-cyan/60" : "border-border",
                    x.status === "CANCELADA" && "opacity-70",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Orçamento {x.position}</p>
                      <p className="truncate text-lg font-bold" title={x.companyName}>{x.companyName}</p>
                      <p className="text-sm text-muted tabular-nums">CNPJ {formatCnpj(x.cnpj)}</p>
                      {x.rating !== null && <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">Nota <RatingBadge value={x.rating} /></p>}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className={cx("rounded-full px-2 py-0.5 text-xs font-bold", PROPOSAL[x.status].tone)}>{PROPOSAL[x.status].label}</span>
                      {row?.lowest && q.comparison.rows.length > 1 && <span className="rounded-full bg-brand-cyan/15 px-2 py-0.5 text-xs font-bold text-brand-cyan">Menor valor</span>}
                    </div>
                  </div>
                  {x.totalValue === null ? (
                    <p className="text-lg font-semibold text-muted">{x.status === "SOLICITADA" ? "Aguardando o valor" : "Valor não chegou"}</p>
                  ) : x.negotiatedValue !== null ? (
                    <div>
                      <p className="text-2xl font-bold tabular-nums">{brl(x.negotiatedValue)}</p>
                      <p className="text-sm text-muted">
                        Negociado{x.negotiatedBy && ` por ${x.negotiatedBy}`}. Recebido: <span className="tabular-nums line-through">{brl(x.totalValue)}</span>
                      </p>
                      {x.negotiationNote && <p className="mt-1 text-sm">{x.negotiationNote}</p>}
                    </div>
                  ) : (
                    <p className="text-2xl font-bold tabular-nums">{brl(x.totalValue)}</p>
                  )}
                  <dl className="space-y-1 text-sm">
                    <Row label="Responsável" value={x.contactName} />
                    <Row label="Telefone" value={formatPhone(x.phone)} />
                    <Row label="E-mail" value={x.email} />
                    {x.paymentTerms && <Row label="Pagamento" value={x.paymentTerms} />}
                  </dl>
                  {x.notes && <p className="whitespace-pre-wrap text-sm text-muted">{x.notes}</p>}
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                    {x.hasFile ? (
                      <a href={`/api/supplier-quotes/${x.id}/file`} target="_blank" rel="noopener" className="min-w-0 truncate text-sm font-semibold text-primary" title={x.fileName ?? ""}>
                        Abrir arquivo · {x.fileName}
                      </a>
                    ) : (
                      <span className="text-sm text-amber-300">Sem arquivo</span>
                    )}
                    {q.can.edit && <QuoteActions quote={x} requestId={q.id} manager={q.can.manage} />}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        {q.comparison.rows.length > 0 && (
          <Panel title="Comparativo">
            {/* Celular: um cartão por fornecedor, do menor para o maior valor. */}
            <ul className="space-y-3 sm:hidden">
              {[...q.comparison.rows].sort((a, b) => a.value - b.value).map((r) => (
                <li key={r.id} className={cx("rounded-xl border p-3", r.id === q.chosenQuoteId ? "border-emerald-500/60 bg-emerald-500/10" : "border-border")}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 font-semibold">{r.companyName}</p>
                    <p className="shrink-0 text-right font-bold tabular-nums">{brl(r.value)}{r.negotiatedValue !== null && <span className="block text-xs font-semibold text-amber-200">negociado</span>}</p>
                  </div>
                  <p className="mt-1 text-sm">
                    {r.lowest ? <span className="font-semibold text-brand-cyan">Menor valor</span> : (
                      <span className="text-amber-300">+{brl(r.diff)}{r.diffPct !== null && ` (+${r.diffPct.toLocaleString("pt-BR")}%)`} que o menor</span>
                    )}
                    {r.id === q.chosenQuoteId && <span className="ml-2 font-semibold text-emerald-300">Escolhido</span>}
                  </p>
                  {r.paymentTerms && <p className="text-sm text-muted">{r.paymentTerms}</p>}
                  {q.can.choose && (
                    <div className="mt-3">
                      <ChooseForm
                        requestId={q.id} quote={{ id: r.id, companyName: r.companyName, value: r.value }} lowest={r.lowest}
                        costItem={q.costItem && { label: q.costItem.label, quantity: q.costItem.quantity, frequency: q.costItem.frequency }}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <div className="-mx-4 hidden overflow-x-auto px-4 sm:block">
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className="text-left text-muted">
                    <th className="py-2 pr-3 font-medium">Fornecedor</th>
                    <th className="py-2 pr-3 text-right font-medium">Valor</th>
                    <th className="py-2 pr-3 text-right font-medium">Diferença para o menor</th>
                    <th className="py-2 pr-3 font-medium">Pagamento</th>
                    {q.can.choose && <th className="w-44 py-2" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {[...q.comparison.rows].sort((a, b) => a.value - b.value).map((r) => (
                    <tr key={r.id} className={cx(r.id === q.chosenQuoteId && "bg-emerald-500/10")}>
                      <td className="py-3 pr-3 align-top">
                        <p className="font-semibold">{r.companyName}</p>
                        {r.id === q.chosenQuoteId && <p className="text-xs font-semibold text-emerald-300">Escolhido</p>}
                      </td>
                      <td className="py-3 pr-3 text-right align-top font-bold tabular-nums">
                        {brl(r.value)}
                        {r.negotiatedValue !== null && <span className="block text-xs font-semibold text-amber-200">negociado · recebido {brl(r.totalValue ?? 0)}</span>}
                      </td>
                      <td className="py-3 pr-3 text-right align-top tabular-nums">
                        {r.lowest ? <span className="font-semibold text-brand-cyan">Menor valor</span> : (
                          <span className="text-amber-300">+{brl(r.diff)}{r.diffPct !== null && ` (+${r.diffPct.toLocaleString("pt-BR")}%)`}</span>
                        )}
                      </td>
                      <td className="py-3 pr-3 align-top text-muted">{r.paymentTerms ?? "—"}</td>
                      {q.can.choose && (
                        <td className="py-3 align-top">
                          <ChooseForm
                            requestId={q.id} quote={{ id: r.id, companyName: r.companyName, value: r.value }} lowest={r.lowest}
                            costItem={q.costItem && { label: q.costItem.label, quantity: q.costItem.quantity, frequency: q.costItem.frequency }}
                          />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {q.comparison.rows.length < 3 && q.status !== "FECHADA" && (
              <p className="mt-3 text-sm text-muted">
                {q.comparison.rows.length} de 3 propostas com valor na disputa. Solicitadas e canceladas não entram no comparativo.
              </p>
            )}
            {!q.can.choose && q.status !== "FECHADA" && q.quotes.length > 0 && (
              <p className="mt-3 text-sm text-muted">Quem escolhe o orçamento é o gestor do evento.</p>
            )}
          </Panel>
        )}
      </main>
    </>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className={cx("min-w-0 truncate text-right font-medium", tone)} title={value}>{value}</dd>
    </div>
  );
}
