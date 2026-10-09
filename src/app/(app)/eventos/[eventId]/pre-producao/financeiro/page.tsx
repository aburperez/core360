import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUseField } from "@/server/authz/policy";
import { getEvent } from "@/modules/events/events.service";
import { canCloseFinancial, getFinancialClosing } from "@/modules/finance/closing.service";
import { brl } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { TopBar } from "@/components/top-bar";
import { EventTabs } from "@/components/event-nav";
import { PageHeading, Panel } from "@/components/panel";
import { EmptyState, LinkButton, PAGE, cx } from "@/components/ui";
import { BudgetTabs } from "../orcamento/tabs";
import { CloseFinancial, PaymentItems, ReopenFinancial } from "./financial-forms";

export const metadata = { title: "Fechamento financeiro" };

/**
 * Fechamento financeiro (fase 7B): contratado × realizado por item, o
 * pagamento (data e nota fiscal) e o motivo dos estouros. No Fechamento, com
 * tudo pago, o executivo ou o diretor fecha e os valores travam.
 */
export default async function FinancialPage({ params }: PageProps<"/eventos/[eventId]/pre-producao/financeiro">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!canCloseFinancial(actor, eventId)) notFound();
  const [event, c] = await Promise.all([getEvent(actor, eventId), getFinancialClosing(actor, eventId)]);
  const t = c.totals;
  const inStage = c.status === "FECHAMENTO";

  return (
    <>
      <TopBar title="Fechamento financeiro" subtitle={event.name} back={`/eventos/${eventId}/pre-producao`} />
      {canUseField(actor, eventId) && <EventTabs eventId={eventId} active="pre" />}
      <BudgetTabs eventId={eventId} active="financeiro" financial />
      <main className={cx(PAGE, "space-y-4 py-4 lg:py-6")}>
        <PageHeading trail={[event.name, "Pré-produção", "Orçamento"]} title="Fechamento financeiro" />

        {c.closed ? (
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4">
            <div className="min-w-0">
              <p className="font-semibold text-emerald-200">Financeiro fechado</p>
              <p className="text-sm text-muted">
                {formatDateTime(c.closed.at)}{c.closed.by ? ` por ${c.closed.by}` : ""}. Os valores do evento estão travados.
                {c.status === "FECHAMENTO" && " Agora o evento pode ir para Concluído."}
              </p>
            </div>
            {c.can.reopen
              ? <ReopenFinancial eventId={eventId} />
              : <p className="text-sm text-muted">Para reabrir, volte o evento para Fechamento.</p>}
          </section>
        ) : (
          <section className={cx("rounded-2xl border p-4", c.can.close ? "border-brand-cyan/50 bg-brand-cyan/10" : "border-border bg-surface")}>
            <h2 className="font-semibold">Para fechar o financeiro</h2>
            <ul className="mt-2 space-y-1.5 text-sm">
              <Check ok={inStage}>Evento na etapa Fechamento{!inStage && <span className="text-muted"> (mude na ficha do evento)</span>}</Check>
              <Check ok={t.withActual === t.items}>Realizado lançado: {t.withActual} de {t.items} {t.items === 1 ? "item" : "itens"}</Check>
              <Check ok={t.paidItems === t.items}>Pagos: {t.paidItems} de {t.items}</Check>
              <Check ok={t.justified === t.overruns}>
                {t.overruns ? `Estouros com motivo: ${t.justified} de ${t.overruns}` : "Nenhum estouro"}
              </Check>
            </ul>
            <div className="mt-3">
              <CloseFinancial eventId={eventId} ready={c.can.close} />
            </div>
            <p className="mt-2 text-xs text-muted">Depois de fechar, os valores travam e o evento pode ir para Concluído.</p>
          </section>
        )}

        {c.items.length === 0 ? (
          <EmptyState title="Nenhum item contratado ainda">
            Entram no fechamento os itens com contratado ou realizado. Preencha no Orçamento.
            <div className="mt-3"><LinkButton href={`/eventos/${eventId}/pre-producao/orcamento`}>Abrir o orçamento</LinkButton></div>
          </EmptyState>
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="Totais">
              <Value label="Contratado" value={t.contracted} hint={`${t.items} ${t.items === 1 ? "item" : "itens"}`} />
              <Value label="Realizado" value={t.actual} hint={`${t.withActual} lançados`} />
              <Value label="Pago" value={t.paid} hint={`${t.paidItems} de ${t.items} pagos`} tone="good" />
              <Value label="A pagar" value={t.toPay} hint={t.toPay ? "Realizado, ou contratado sem realizado" : "Nada a pagar"} tone={t.toPay ? "warn" : undefined} />
              <Value
                label="Estouros"
                value={t.overrun}
                hint={t.overruns ? `${t.overruns} ${t.overruns === 1 ? "item" : "itens"} · ${t.overruns - t.justified} sem motivo` : "Nenhum item passou do contratado"}
                tone={t.overrun ? "bad" : undefined}
              />
            </section>
            <PaymentItems eventId={eventId} items={c.items} editable={c.can.edit} />
            <p className="text-xs text-muted">
              {c.leftOut ? `${c.leftOut} ${c.leftOut === 1 ? "item sem contratado nem realizado (ou opcional) fica" : "itens sem contratado nem realizado (ou opcionais) ficam"} fora. ` : ""}
              {t.below ? `Pago abaixo do contratado: ${brl(t.below)}. ` : ""}
              Valores dos fornecedores, sem honorários e encargos.
            </p>
          </>
        )}
      </main>
    </>
  );
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span aria-hidden className={cx("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs font-bold", ok ? "bg-emerald-500 text-black" : "bg-white/10 text-muted")}>
        {ok ? "✓" : "•"}
      </span>
      <span className={ok ? "" : "text-foreground"}>{children}<span className="sr-only">{ok ? " (feito)" : " (falta)"}</span></span>
    </li>
  );
}

function Value({ label, value, hint, tone }: { label: string; value: number; hint: string; tone?: "good" | "warn" | "bad" }) {
  return (
    <Panel className={cx(tone === "bad" && "border-red-400/40", tone === "warn" && "border-amber-400/40")}>
      <p className={cx("text-xs font-semibold uppercase tracking-wide", tone === "good" ? "text-emerald-300" : tone === "warn" ? "text-amber-300" : tone === "bad" ? "text-red-300" : "text-muted")}>{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums lg:text-2xl">{brl(value)}</p>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>
    </Panel>
  );
}
