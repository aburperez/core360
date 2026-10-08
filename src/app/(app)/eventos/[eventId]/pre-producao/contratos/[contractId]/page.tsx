import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { NotFoundError } from "@/server/errors";
import { getContract } from "@/modules/contracts/contracts.service";
import { maxDocumentBytes } from "@/modules/documents/file";
import { TopBar } from "@/components/top-bar";
import { PageHeading, Panel } from "@/components/panel";
import { Card, PAGE, cx } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { formatCnpj } from "@/lib/cnpj";
import { formatPhone } from "@/lib/phone";
import { formatBytes } from "@/lib/documents";
import { brl } from "@/lib/money";
import { AddItem, DataForm, ItemActions, PdfUpload, StatusActions } from "../forms";
import { CONTRACT, formatDay } from "../status";

export const metadata = { title: "Contrato" };

/**
 * Um contrato: as propostas aprovadas que ele cobre (com o valor de cada uma),
 * os dados de pagamento e entrega, o PDF e o andamento até assinado.
 */
export default async function ContractPage({ params }: PageProps<"/eventos/[eventId]/pre-producao/contratos/[contractId]">) {
  const actor = await requireUser();
  const { eventId, contractId } = await params;
  const c = await getContract(actor, contractId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  if (c.eventId !== eventId) notFound();
  const st = CONTRACT[c.status];
  const supplier = c.supplier.tradeName || c.supplier.companyName;
  const title = `Contrato nº ${c.number}`;
  const quotes = `/eventos/${eventId}/pre-producao/cotacoes`;
  const changed = c.items.some((i) => i.value !== i.proposalValue);

  return (
    <>
      <TopBar title={title} subtitle={supplier} back={`/eventos/${eventId}/pre-producao/contratos`} />
      <main className={cx(PAGE, "space-y-4 py-4 lg:py-6")}>
        <PageHeading trail={[c.eventName, "Pré-produção", "Contratos"]} title={`${title} · ${supplier}`}>
          <span className={cx("rounded-full px-3 py-1 text-sm font-semibold", st.tone)}>{st.label}</span>
        </PageHeading>
        <span className={cx("inline-block rounded-full px-3 py-1 text-sm font-semibold lg:hidden", st.tone)}>{st.label}</span>

        {c.status === "ASSINADO" && (
          <Card className="border-emerald-500/40 bg-emerald-500/10">
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-300">Assinado</p>
            <p className="mt-1 text-xl font-bold">{brl(c.total)} · em {formatDay(c.signedOn!)}</p>
            <p className="mt-1 text-sm text-muted">Marcado por {c.signedBy?.name}. O valor já está no Contratado do Orçamento.</p>
          </Card>
        )}
        {c.status === "CANCELADO" && (
          <Card className="border-red-500/40 bg-red-500/10">
            <p className="text-sm font-semibold uppercase tracking-wide text-red-300">Cancelado</p>
            <p className="mt-1">{c.cancelReason}</p>
            <p className="mt-1 text-sm text-muted">{c.cancelledBy?.name} · {formatDateTime(c.cancelledAt)}</p>
          </Card>
        )}

        <div className="gap-4 space-y-4 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:space-y-0">
          <div className="min-w-0 space-y-4">
            <Panel title="O que o contrato cobre" action={<span className="text-lg font-bold tabular-nums">{brl(c.total)}</span>}>
              {c.items.length === 0 ? (
                <p className="text-sm text-amber-300">Nenhuma proposta. Inclua pelo menos uma antes de enviar.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {c.items.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">
                          {i.code && <span className="mr-2 text-sm font-semibold text-muted tabular-nums">{i.code}</span>}
                          {i.name}
                        </p>
                        <p className="text-sm text-muted">
                          Cotação: <Link href={`${quotes}/${i.requestId}`} className="text-primary hover:underline">{i.requestTitle}</Link>
                          {i.paymentTerms && ` · ${i.paymentTerms}`}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold tabular-nums">{brl(i.value)}</p>
                        {i.value !== i.proposalValue && <p className="text-xs text-amber-200">proposta: {brl(i.proposalValue)}</p>}
                      </div>
                      {(c.can.edit || c.can.changeValue) && (
                        <div className="w-full">
                          <ItemActions item={i} canEdit={c.can.edit} canChangeValue={c.can.changeValue} />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {c.can.edit && c.available.length > 0 && (
                <div className="mt-4 border-t border-border pt-4">
                  <AddItem
                    contractId={c.id}
                    options={c.available.map((a) => ({ quoteId: a.quoteId, label: `${a.code ? `${a.code} ` : ""}${a.name} · ${brl(a.value)}` }))}
                  />
                </div>
              )}
              {c.can.edit && !c.can.director && (
                <p className="mt-3 text-sm text-muted">O valor vem da proposta aprovada. Só o diretor muda o valor no contrato.</p>
              )}
              {changed && c.status !== "CANCELADO" && <p className="mt-3 text-sm text-muted">Onde aparece o valor da proposta embaixo, o diretor ajustou o valor no contrato.</p>}
            </Panel>

            <Panel title="Pagamento e entrega">
              {c.can.edit ? (
                <DataForm id={c.id} initial={{ paymentTerms: c.paymentTerms, deliveryNotes: c.deliveryNotes, notes: c.notes }} />
              ) : (
                <dl className="space-y-3 text-sm">
                  <Text label="Condição de pagamento" value={c.paymentTerms} />
                  <Text label="Entrega e retirada" value={c.deliveryNotes} />
                  {c.notes && <Text label="Observações" value={c.notes} />}
                </dl>
              )}
              {c.status === "ENVIADO" && <p className="mt-3 text-sm text-muted">Enviado ao fornecedor: para mudar, volte para rascunho.</p>}
            </Panel>
          </div>

          <div className="min-w-0 space-y-4">
            <Panel title="Fornecedor">
              <p className="font-semibold">{c.supplier.companyName}</p>
              <dl className="mt-2 space-y-1 text-sm">
                <Row label="CNPJ" value={formatCnpj(c.supplier.cnpj)} />
                {c.supplier.contactName && <Row label="Responsável" value={c.supplier.contactName} />}
                {c.supplier.phone && <Row label="Telefone" value={formatPhone(c.supplier.phone)} />}
                {c.supplier.email && <Row label="E-mail" value={c.supplier.email} />}
              </dl>
            </Panel>

            <Panel title="PDF do contrato">
              {c.document ? (
                <a href={`/api/documents/${c.document.id}/file`} target="_blank" rel="noopener" className="block truncate font-semibold text-primary" title={c.document.fileName}>
                  Abrir · {c.document.fileName}
                </a>
              ) : (
                <p className="text-sm text-amber-300">Ainda sem PDF.</p>
              )}
              {c.document && <p className="text-sm text-muted">{formatBytes(c.document.sizeBytes)} · {formatDateTime(c.document.createdAt)}</p>}
              {c.can.attach && <div className="mt-3"><PdfUpload id={c.id} hasFile={!!c.document} maxBytes={maxDocumentBytes()} /></div>}
              <p className="mt-3 text-sm text-muted">O PDF também fica em Documentos, na categoria Contrato. Ele não vai para o campo.</p>
            </Panel>

            <Panel title="Andamento">
              <dl className="space-y-2 text-sm">
                <Row label="Criado" value={`${c.createdBy.name} · ${formatDateTime(c.createdAt)}`} />
                <Row label="Enviado" value={c.sentAt ? formatDateTime(c.sentAt) : "Ainda não"} />
                <Row label="Assinado" value={c.signedOn ? formatDay(c.signedOn) : "Ainda não"} tone={c.signedOn ? "text-emerald-300" : undefined} />
              </dl>
              {(c.can.send || c.can.backToDraft || c.can.sign || c.can.cancel) && (
                <div className="mt-4 border-t border-border pt-4">
                  <StatusActions id={c.id} can={c.can} hasFile={!!c.document} />
                </div>
              )}
              {!c.can.director && (c.status === "RASCUNHO" || c.status === "ENVIADO") && (
                <p className="mt-3 text-sm text-muted">Quem marca como assinado é o diretor.</p>
              )}
            </Panel>
          </div>
        </div>
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

function Text({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap">{value ?? "—"}</dd>
    </div>
  );
}
