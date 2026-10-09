import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUseField } from "@/server/authz/policy";
import { membershipFor } from "@/server/authz/actor";
import { getEvent } from "@/modules/events/events.service";
import { listContractedSuppliers } from "@/modules/suppliers/suppliers.service";
import { myRatings } from "@/modules/suppliers/ratings.service";
import { ratingText } from "@/modules/suppliers/rating-meta";
import { RatingBars } from "@/components/rating";
import { EditRating, RatingForm } from "../pre-producao/avaliacao/rating-form";
import { bonusText, canSeeContractedSuppliers } from "@/modules/suppliers/supplier-meta";
import { formatPhone } from "@/lib/phone";
import { TopBar } from "@/components/top-bar";
import { PageHeading, Panel } from "@/components/panel";
import { EmptyState, PAGE, cx } from "@/components/ui";

export const metadata = { title: "Fornecedores" };

const waLink = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "")}`;

/**
 * Campo: os fornecedores contratados para os itens do evento, com contato e a
 * bonificação. O gestor vê todos; o Head, os da área dele. Sem valores. No
 * Fechamento, cada um avalia aqui os que tiveram contrato assinado.
 */
export default async function FieldSuppliersPage({ params }: PageProps<"/eventos/[eventId]/fornecedores">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!canUseField(actor, eventId) || !canSeeContractedSuppliers(actor, eventId)) notFound();
  const [event, data, rate] = await Promise.all([getEvent(actor, eventId), listContractedSuppliers(actor, eventId), myRatings(actor, eventId)]);
  const head = membershipFor(actor, eventId)?.role === "HEAD";
  const toRate = data.items.filter((s) => rate.canRate.has(s.id));
  const rated = toRate.filter((s) => rate.mine.has(s.id)).length;

  return (
    <>
      <TopBar title="Fornecedores" subtitle={event.name} />
      <main className={cx(PAGE, "space-y-4 py-4 lg:py-6")}>
        <PageHeading trail={[event.name, "Gestão de campo"]} title="Fornecedores contratados" />
        <p className="text-sm text-muted">
          {head ? "Os fornecedores contratados para os itens da sua área" : "Os fornecedores contratados para os itens do evento"}, com o contato de cada um e a bonificação. Valores não aparecem aqui.
        </p>
        {rate.open && toRate.length > 0 && (
          <div className={cx("rounded-2xl border p-4", rated === toRate.length ? "border-emerald-500/40 bg-emerald-500/10" : "border-brand-cyan/40 bg-brand-cyan/10")}>
            <b>{rated === toRate.length ? "Você já avaliou todos os fornecedores." : "O evento está no Fechamento. Avalie os fornecedores."}</b>
            <span className="block text-sm text-muted">
              {rated} de {toRate.length} avaliados. Dê de 0 a 10 em cada critério; a nota ajuda a escolher os fornecedores dos próximos eventos.
            </span>
          </div>
        )}
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
                {rate.open && rate.canRate.has(s.id) && (
                  <div className="mt-4 border-t border-border pt-3">
                    {rate.mine.get(s.id) ? (
                      <div className="space-y-3">
                        <p className="flex items-center justify-between gap-3 text-sm">
                          <span className="font-semibold uppercase tracking-wide text-muted">Sua avaliação</span>
                          <b className="text-2xl tabular-nums">{ratingText(rate.mine.get(s.id)!.average)}</b>
                        </p>
                        <RatingBars scores={rate.mine.get(s.id)!} />
                        <EditRating eventId={eventId} supplierId={s.id} initial={rate.mine.get(s.id)!} />
                      </div>
                    ) : (
                      <>
                        <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-amber-200">Avalie este fornecedor</p>
                        <RatingForm eventId={eventId} supplierId={s.id} initial={null} />
                      </>
                    )}
                  </div>
                )}
              </Panel>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
