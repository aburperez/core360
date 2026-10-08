import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUsePreProduction } from "@/server/authz/policy";
import { getEvent } from "@/modules/events/events.service";
import { listContracts } from "@/modules/contracts/contracts.service";
import { brl } from "@/lib/money";
import { TopBar } from "@/components/top-bar";
import { PageHeading, Panel } from "@/components/panel";
import { EmptyState, PAGE, cx } from "@/components/ui";
import { CreateContract } from "./forms";
import { CONTRACT, formatDay } from "./status";

export const metadata = { title: "Contratos" };

/**
 * Contratos do evento: um por fornecedor, com as propostas aprovadas dele. Em
 * cima, os fornecedores aprovados que ainda não têm contrato.
 */
export default async function ContractsPage({ params }: PageProps<"/eventos/[eventId]/pre-producao/contratos">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!canUsePreProduction(actor, eventId)) notFound();
  const [event, data] = await Promise.all([getEvent(actor, eventId), listContracts(actor, eventId)]);
  const base = `/eventos/${eventId}/pre-producao/contratos`;
  const signed = data.items.filter((c) => c.status === "ASSINADO");

  return (
    <>
      <TopBar title="Contratos" subtitle={event.name} back={`/eventos/${eventId}/pre-producao`} />
      <main className={cx(PAGE, "space-y-4 py-4 lg:py-6")}>
        <PageHeading trail={[event.name, "Pré-produção"]} title="Contratos" />
        <p className="text-sm text-muted">
          Um contrato por fornecedor, com as propostas aprovadas dele nas cotações. A Pré-produção monta, anexa o PDF e envia;
          {data.can.director ? " você" : " o diretor"} muda valores, marca como assinado e cancela. Assinado, o valor vira o Contratado do Orçamento.
        </p>

        {data.pending.length > 0 && (
          <Panel title="Fornecedores aprovados sem contrato">
            <ul className="divide-y divide-border">
              {data.pending.map((p) => (
                <li key={p.supplierId} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-sm text-muted">
                      {p.proposals} {p.proposals === 1 ? "proposta aprovada" : "propostas aprovadas"} · <span className="tabular-nums">{brl(p.total)}</span>
                    </p>
                  </div>
                  {p.hasContract ? (
                    <p className="text-sm text-amber-300">Já tem contrato: volte ele para rascunho e inclua a proposta.</p>
                  ) : (
                    <CreateContract eventId={eventId} supplierId={p.supplierId} />
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {data.items.length === 0 ? (
          <EmptyState title="Nenhum contrato ainda">
            {data.pending.length ? "Crie o contrato de um fornecedor aprovado aqui em cima." : (
              <>Quando o gestor escolher um orçamento em <Link href={`/eventos/${eventId}/pre-producao/cotacoes`} className="text-primary underline">Cotações</Link>, o fornecedor aparece aqui.</>
            )}
          </EmptyState>
        ) : (
          <Panel
            title={`${data.items.length} ${data.items.length === 1 ? "contrato" : "contratos"}`}
            action={signed.length > 0 && <span className="text-sm text-muted">Assinados: <b className="tabular-nums text-foreground">{brl(signed.reduce((s, c) => s + c.total, 0))}</b></span>}
          >
            <ul className="space-y-2">
              {data.items.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`${base}/${c.id}`}
                    className={cx("flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border p-3 transition hover:border-primary/60", c.status === "CANCELADO" && "opacity-70")}
                  >
                    <span className="w-12 shrink-0 text-sm font-semibold text-muted tabular-nums">nº {c.number}</span>
                    <span className="min-w-0 flex-1 font-semibold">{c.supplier}</span>
                    <span className={cx("rounded-full px-2 py-0.5 text-xs font-bold", CONTRACT[c.status].tone)}>{CONTRACT[c.status].label}</span>
                    <span className="w-full text-sm text-muted sm:w-auto">
                      {c.items} {c.items === 1 ? "proposta" : "propostas"}
                      {c.status === "ASSINADO" && c.signedOn && ` · assinado em ${formatDay(c.signedOn)}`}
                      {!c.hasFile && c.status !== "CANCELADO" && <span className="text-amber-300"> · sem PDF</span>}
                    </span>
                    <span className="ml-auto text-lg font-bold tabular-nums">{brl(c.total)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </main>
    </>
  );
}
