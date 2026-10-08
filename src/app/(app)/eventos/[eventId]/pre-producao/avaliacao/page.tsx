import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUsePreProduction } from "@/server/authz/policy";
import { isSupplierDirector } from "@/modules/suppliers/supplier-meta";
import { listEventRatings } from "@/modules/suppliers/ratings.service";
import { EVENT_STATUS_LABEL } from "@/lib/event-stages";
import { formatDateTime } from "@/lib/format";
import { brl } from "@/lib/money";
import { ratingText } from "@/modules/suppliers/rating-meta";
import { TopBar } from "@/components/top-bar";
import { PageHeading, Panel } from "@/components/panel";
import { RatingBadge, RatingBars } from "@/components/rating";
import { EmptyState, PAGE, cx } from "@/components/ui";
import { EditRating, RatingForm } from "./rating-form";

export const metadata = { title: "Avaliar fornecedores" };

/**
 * No Fechamento, o diretor dá de 0 a 10 em 6 critérios para cada fornecedor
 * com contrato assinado no evento. A média vai para o cadastro e a cotação.
 */
export default async function RatingsPage({ params }: PageProps<"/eventos/[eventId]/pre-producao/avaliacao">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!canUsePreProduction(actor, eventId) || !isSupplierDirector(actor, eventId)) notFound();
  const data = await listEventRatings(actor, eventId);
  const suppliers = `/eventos/${eventId}/pre-producao/fornecedores`;

  return (
    <>
      <TopBar title="Avaliar fornecedores" subtitle={data.eventName} back={`/eventos/${eventId}/pre-producao/contratos`} />
      <main className={cx(PAGE, "space-y-4 py-4 lg:py-6")}>
        <PageHeading trail={[data.eventName, "Pré-produção", "Contratos"]} title="Avaliar fornecedores">
          {data.items.length > 0 && (
            <span className={cx("rounded-full px-3 py-1 text-sm font-semibold", data.done === data.items.length ? "bg-emerald-500/15 text-emerald-300" : "bg-white/10 text-muted")}>
              {data.done} de {data.items.length} avaliados
            </span>
          )}
        </PageHeading>
        <p className="text-sm text-muted">
          De 0 a 10 em cada critério, para cada fornecedor com contrato assinado. A média de todos os eventos aparece em Fornecedores e na cotação,
          para a Pré-produção escolher melhor. As notas de cada evento e o comentário só o diretor vê. O campo e o cliente não veem nada.
        </p>

        {!data.open && (
          <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm">
            O evento está em <b>{EVENT_STATUS_LABEL[data.status] ?? data.status}</b>. A avaliação abre quando ele chegar no Fechamento.
          </p>
        )}

        {data.items.length === 0 ? (
          <EmptyState title="Nenhum fornecedor com contrato assinado">
            Os fornecedores aparecem aqui quando o contrato deles é marcado como assinado em <Link href={`/eventos/${eventId}/pre-producao/contratos`} className="text-primary underline">Contratos</Link>.
          </EmptyState>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {data.items.map((s) => (
              <Panel key={s.supplierId} className={cx("min-w-0", s.rating && "border-emerald-500/30")}>
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`${suppliers}/${s.supplierId}`} className="text-lg font-bold text-primary hover:underline">{s.name}</Link>
                    <p className="text-sm text-muted">
                      Contrato nº {s.contracts.join(", ")} · <span className="tabular-nums">{brl(s.total)}</span>
                    </p>
                    {s.history && (
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                        Média geral <RatingBadge value={s.history.overall} count={s.history.ratings} />
                      </p>
                    )}
                  </div>
                  {s.rating ? (
                    <div className="text-right">
                      <p className="text-3xl font-bold tabular-nums">{ratingText(s.rating.average)}</p>
                      <p className="text-xs text-muted">neste evento</p>
                    </div>
                  ) : data.open && (
                    <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-bold text-amber-200">Falta avaliar</span>
                  )}
                </div>
                {s.rating ? (
                  <div className="space-y-3">
                    <RatingBars scores={s.rating} />
                    {s.rating.comment && <p className="whitespace-pre-wrap rounded-xl bg-background/50 p-3 text-sm">{s.rating.comment}</p>}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                      <p className="text-xs text-muted">{s.rating.ratedBy} · {formatDateTime(s.rating.updatedAt)}</p>
                      {data.open && <EditRating eventId={eventId} supplierId={s.supplierId} initial={s.rating} />}
                    </div>
                  </div>
                ) : data.open ? (
                  <RatingForm eventId={eventId} supplierId={s.supplierId} initial={null} />
                ) : (
                  <p className="text-sm text-muted">Aguardando o Fechamento.</p>
                )}
              </Panel>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
