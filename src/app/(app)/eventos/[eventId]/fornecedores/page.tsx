import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUseField } from "@/server/authz/policy";
import { membershipFor } from "@/server/authz/actor";
import { getEvent } from "@/modules/events/events.service";
import { listContractedSuppliers } from "@/modules/suppliers/suppliers.service";
import { bonusText, canSeeContractedSuppliers } from "@/modules/suppliers/supplier-meta";
import { formatPhone } from "@/lib/phone";
import { TopBar } from "@/components/top-bar";
import { PageHeading, Panel } from "@/components/panel";
import { EmptyState, PAGE, cx } from "@/components/ui";

export const metadata = { title: "Fornecedores" };

const waLink = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "")}`;

/**
 * Campo: os fornecedores contratados para os itens do evento, com contato e a
 * bonificação. O gestor vê todos; o Head, os da área dele. Sem valores.
 */
export default async function FieldSuppliersPage({ params }: PageProps<"/eventos/[eventId]/fornecedores">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!canUseField(actor, eventId) || !canSeeContractedSuppliers(actor, eventId)) notFound();
  const [event, data] = await Promise.all([getEvent(actor, eventId), listContractedSuppliers(actor, eventId)]);
  const head = membershipFor(actor, eventId)?.role === "HEAD";

  return (
    <>
      <TopBar title="Fornecedores" subtitle={event.name} />
      <main className={cx(PAGE, "space-y-4 py-4 lg:py-6")}>
        <PageHeading trail={[event.name, "Gestão de campo"]} title="Fornecedores contratados" />
        <p className="text-sm text-muted">
          {head ? "Os fornecedores contratados para os itens da sua área" : "Os fornecedores contratados para os itens do evento"}, com o contato de cada um e a bonificação. Valores não aparecem aqui.
        </p>
        {data.items.length === 0 ? (
          <EmptyState title="Nenhum fornecedor contratado ainda">
            {head ? "Quando a pré-produção fechar a cotação de um item da sua área, o fornecedor aparece aqui." : "Quando uma cotação de item for fechada, o fornecedor escolhido aparece aqui."}
          </EmptyState>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {data.items.map((s) => (
              <Panel key={s.id} title={s.tradeName || s.companyName}>
                <dl className="space-y-1.5 text-sm">
                  {s.contactName && <div><dt className="inline text-muted">Contato: </dt><dd className="inline">{s.contactName}</dd></div>}
                  {s.phone && (
                    <div>
                      <dt className="inline text-muted">Telefone: </dt>
                      <dd className="inline"><a href={`tel:${s.phone}`} className="text-primary underline">{formatPhone(s.phone)}</a></dd>
                    </div>
                  )}
                  {(s.whatsapp || s.phone) && (
                    <div>
                      <dt className="inline text-muted">WhatsApp: </dt>
                      <dd className="inline"><a href={waLink(s.whatsapp || s.phone!)} target="_blank" rel="noreferrer" className="text-primary underline">{formatPhone(s.whatsapp || s.phone!)}</a></dd>
                    </div>
                  )}
                  {s.email && (
                    <div><dt className="inline text-muted">E-mail: </dt><dd className="inline"><a href={`mailto:${s.email}`} className="text-primary underline">{s.email}</a></dd></div>
                  )}
                  <div>
                    <dt className="inline text-muted">Bonificação: </dt>
                    <dd className="inline">{s.bonus ? bonusText(s.bonus) : "nenhuma"}</dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">Itens</p>
                <ul className="mt-1 space-y-1 text-sm">
                  {s.items.map((it) => (
                    <li key={it.id}>
                      <span className="font-mono text-xs text-primary">{it.code}</span> {it.name}
                      {it.area && !head && <span className="text-muted"> · {it.area}</span>}
                    </li>
                  ))}
                </ul>
              </Panel>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
