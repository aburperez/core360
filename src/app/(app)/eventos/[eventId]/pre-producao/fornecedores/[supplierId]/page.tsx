import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUsePreProduction } from "@/server/authz/policy";
import { getEvent } from "@/modules/events/events.service";
import { getSupplier } from "@/modules/suppliers/suppliers.service";
import { bonusText } from "@/modules/suppliers/supplier-meta";
import { CATEGORY } from "@/modules/items/item-meta";
import { formatCnpj } from "@/lib/cnpj";
import { formatPhone } from "@/lib/phone";
import { brl } from "@/lib/money";
import { TopBar } from "@/components/top-bar";
import { PageHeading, Panel } from "@/components/panel";
import { PAGE, cx } from "@/components/ui";
import { RatingBadge, RatingBars } from "@/components/rating";
import { ratingText } from "@/modules/suppliers/rating-meta";
import { ArchiveSupplier, BonusForm, EditSupplier } from "../supplier-forms";

export const metadata = { title: "Fornecedor" };

const RESULT = {
  ESCOLHIDO: { label: "Escolhido", tone: "text-emerald-300" },
  NAO_ESCOLHIDO: { label: "Não escolhido", tone: "text-muted" },
  CANCELADA: { label: "Cotação cancelada", tone: "text-muted" },
  EM_ANDAMENTO: { label: "Em andamento", tone: "text-amber-300" },
} as const;

const date = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" });

/** Ficha do fornecedor: dados, bonificação (diretor) e histórico de orçamentos. */
export default async function SupplierPage({ params }: PageProps<"/eventos/[eventId]/pre-producao/fornecedores/[supplierId]">) {
  const actor = await requireUser();
  const { eventId, supplierId } = await params;
  if (!canUsePreProduction(actor, eventId)) notFound();
  const [event, data] = await Promise.all([getEvent(actor, eventId), getSupplier(actor, eventId, supplierId).catch(() => null)]);
  if (!data) notFound();
  const s = data.supplier;
  const list = `/eventos/${eventId}/pre-producao/fornecedores`;
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex flex-col gap-0.5 border-b border-border/60 py-2 last:border-0 sm:flex-row sm:gap-4">
      <dt className="text-sm text-muted sm:w-44 sm:shrink-0">{label}</dt>
      <dd className="min-w-0 whitespace-pre-line break-words">{value || <span className="text-muted">—</span>}</dd>
    </div>
  );

  return (
    <>
      <TopBar title={s.tradeName || s.companyName} subtitle="Fornecedor" back={list} />
      <main className={cx(PAGE, "space-y-4 py-4 lg:py-6")}>
        <PageHeading trail={[event.name, "Pré-produção", "Fornecedores"]} title={s.tradeName || s.companyName}>
          {data.can.edit && <EditSupplier eventId={eventId} supplier={s} />}
        </PageHeading>
        {s.archivedAt && (
          <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm">
            Arquivado em {date(s.archivedAt)}. Não aparece nas cotações novas.
          </p>
        )}

        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <Panel title="Dados">
            <dl>
              {row("Razão social", s.companyName)}
              {row("CNPJ", <span className="tabular-nums">{formatCnpj(s.cnpj)}</span>)}
              {row("Contato", s.contactName)}
              {row("Telefone", s.phone && formatPhone(s.phone))}
              {row("WhatsApp", s.whatsapp && formatPhone(s.whatsapp))}
              {row("E-mail", s.email && <a href={`mailto:${s.email}`} className="text-primary underline">{s.email}</a>)}
              {row("Cidade", [s.city, s.state].filter(Boolean).join("/"))}
              {row("Região de atendimento", s.region)}
              {row("Categorias", s.categories.map((c) => CATEGORY[c].label).join(", "))}
              {row("Especialidade", s.specialty)}
              {row("Equipe", s.team)}
              {row("Equipamentos", s.equipment)}
              {row("Capacidade", s.capacity)}
              {row("Observações", s.notes)}
            </dl>
            <p className="mt-3 text-xs text-muted">Cadastrado por {s.createdBy} em {date(s.createdAt)}.</p>
          </Panel>

          <div className="space-y-4">
            <Panel title="Avaliação" action={data.rating && <RatingBadge value={data.rating.overall} count={data.rating.ratings} />}>
              {data.rating ? (
                <>
                  <RatingBars scores={data.rating} />
                  <p className="mt-3 text-xs text-muted">
                    Média de {data.rating.ratings} {data.rating.ratings === 1 ? "evento" : "eventos"}, de 0 a 10. O diretor avalia no Fechamento de cada evento.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted">Ainda sem avaliação. O diretor avalia no Fechamento de cada evento em que o fornecedor teve contrato assinado.</p>
              )}
              {data.ratings.length > 0 && (
                <ul className="mt-4 divide-y divide-border/60 border-t border-border pt-2">
                  {data.ratings.map((r) => {
                    const avg = (r.quality + r.deadline + r.service + r.cost + r.flexibility + r.problemSolving) / 6;
                    return (
                      <li key={r.eventId} className="py-2.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="min-w-0 font-semibold">{r.eventName}</p>
                          <p className="shrink-0 font-bold tabular-nums">{ratingText(avg)}</p>
                        </div>
                        {r.comment && <p className="mt-1 whitespace-pre-wrap text-sm">{r.comment}</p>}
                        <p className="text-xs text-muted">{r.ratedBy} · {date(new Date(r.updatedAt))}</p>
                      </li>
                    );
                  })}
                </ul>
              )}
              {data.ratings.length > 0 && <p className="mt-2 text-xs text-muted">As notas de cada evento e os comentários só o diretor vê.</p>}
            </Panel>
            {data.can.director && (
              <Panel title="Bonificação">
                {data.bonus && (
                  <p className="mb-3">
                    <span className="text-lg font-semibold">{bonusText(data.bonus)}</span>
                    <span className="block text-xs text-muted">Por {data.bonus.updatedBy} em {date(new Date(data.bonus.updatedAt))}</span>
                  </p>
                )}
                <BonusForm eventId={eventId} supplierId={s.id} bonus={data.bonus} />
                <p className="mt-3 text-xs text-muted">Só o diretor e o Head da área em que o fornecedor foi contratado veem. O pré-produtor, o campo e o cliente não veem.</p>
              </Panel>
            )}
            {data.can.archive && (
              <Panel title={s.archivedAt ? "Arquivado" : "Arquivar"}>
                <p className="mb-2 text-sm text-muted">
                  {s.archivedAt ? "Reativado, ele volta para a lista e para as cotações." : "Arquivado, ele sai da lista e das cotações novas. O histórico fica guardado."}
                </p>
                <ArchiveSupplier eventId={eventId} supplierId={s.id} archived={!!s.archivedAt} name={s.companyName} />
              </Panel>
            )}
          </div>
        </div>

        <Panel title={`Orçamentos (${data.history.length})`}>
          {data.history.length === 0 ? (
            <p className="text-sm text-muted">Nenhum orçamento ainda nos eventos em que você trabalha.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {data.history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
                  <div className="min-w-0">
                    <Link href={`/eventos/${h.eventId}/pre-producao/cotacoes/${h.requestId}`} className="font-semibold text-primary hover:underline">{h.title}</Link>
                    <p className="text-xs text-muted">{h.eventName} · {date(h.date)}</p>
                  </div>
                  <div className="text-right">
                    <p className="tabular-nums">{h.value === null ? <span className="text-muted">Sem valor</span> : brl(h.value)}</p>
                    <p className={cx("text-xs", RESULT[h.result].tone)}>{RESULT[h.result].label}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </main>
    </>
  );
}
