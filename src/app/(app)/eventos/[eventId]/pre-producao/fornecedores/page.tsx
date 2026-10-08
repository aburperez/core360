import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUsePreProduction } from "@/server/authz/policy";
import { getEvent } from "@/modules/events/events.service";
import { listSuppliers } from "@/modules/suppliers/suppliers.service";
import { bonusText } from "@/modules/suppliers/supplier-meta";
import { CATEGORY } from "@/modules/items/item-meta";
import { formatCnpj } from "@/lib/cnpj";
import { formatPhone } from "@/lib/phone";
import { TopBar } from "@/components/top-bar";
import { PageHeading, Panel } from "@/components/panel";
import { EmptyState, PAGE, cx } from "@/components/ui";
import { RatingBadge } from "@/components/rating";
import { NewSupplier, SupplierFilters } from "./supplier-forms";

export const metadata = { title: "Fornecedores" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? undefined;

/**
 * Cadastro de fornecedores da agência: um por CNPJ, usado em todos os eventos.
 * A bonificação só aparece para o diretor.
 */
export default async function SuppliersPage({ params, searchParams }: PageProps<"/eventos/[eventId]/pre-producao/fornecedores">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!canUsePreProduction(actor, eventId)) notFound();
  const q = await searchParams;
  const [event, data] = await Promise.all([
    getEvent(actor, eventId),
    listSuppliers(actor, eventId, { q: one(q.q), category: one(q.categoria), archived: one(q.arquivados) === "1" }),
  ]);
  const base = `/eventos/${eventId}/pre-producao/fornecedores`;
  const filtered = !!(data.filters.q || data.filters.category);

  return (
    <>
      <TopBar title="Fornecedores" subtitle={event.name} back={`/eventos/${eventId}/pre-producao`} />
      <main className={cx(PAGE, "space-y-4 py-4 lg:py-6")}>
        <PageHeading trail={[event.name, "Pré-produção"]} title={data.filters.archived ? "Fornecedores arquivados" : "Fornecedores"}>
          {data.can.edit && <NewSupplier eventId={eventId} />}
        </PageHeading>
        <p className="text-sm text-muted">
          O cadastro é da agência: vale para todos os eventos. Também dá para cadastrar um fornecedor novo direto no orçamento da cotação.
          {" A nota é a média das avaliações do diretor no Fechamento de cada evento."}
          {data.can.director && " A bonificação só aparece para o diretor e para o Head da área em que o fornecedor foi contratado."}
        </p>

        <SupplierFilters archivedCount={data.archivedCount} />

        {data.items.length === 0 ? (
          <EmptyState title={filtered ? "Nenhum fornecedor com estes filtros" : data.filters.archived ? "Nenhum fornecedor arquivado" : "Nenhum fornecedor ainda"}>
            {filtered ? <Link href={base} className="text-primary underline">Limpar os filtros</Link>
              : "Cadastre pelo botão Novo fornecedor ou registre um orçamento numa cotação."}
          </EmptyState>
        ) : (
          <Panel title={`${data.items.length} ${data.items.length === 1 ? "fornecedor" : "fornecedores"}`}>
            {/* Computador: tabela. Celular: cartões. */}
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                    <th className="py-2 pr-3 font-semibold">Fornecedor</th>
                    <th className="py-2 pr-3 font-semibold">Contato</th>
                    <th className="py-2 pr-3 font-semibold">Cidade</th>
                    <th className="py-2 pr-3 font-semibold">Categorias</th>
                    <th className="py-2 pr-3 font-semibold">Nota</th>
                    <th className="py-2 pr-3 text-right font-semibold">Orçamentos</th>
                    {data.can.director && <th className="py-2 font-semibold">Bonificação</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((s) => (
                    <tr key={s.id} className="border-b border-border/60 align-top last:border-0">
                      <td className="py-2.5 pr-3">
                        <Link href={`${base}/${s.id}`} className="font-semibold text-primary hover:underline">{s.tradeName || s.companyName}</Link>
                        <p className="text-xs text-muted">{s.tradeName ? `${s.companyName} · ` : ""}{formatCnpj(s.cnpj)}</p>
                      </td>
                      <td className="py-2.5 pr-3">
                        {s.contactName ?? "—"}
                        <p className="text-xs text-muted">{[s.phone && formatPhone(s.phone), s.email].filter(Boolean).join(" · ")}</p>
                      </td>
                      <td className="py-2.5 pr-3">{[s.city, s.state].filter(Boolean).join("/") || "—"}</td>
                      <td className="py-2.5 pr-3 text-muted">{s.categories.map((c) => CATEGORY[c].label).join(", ") || "—"}</td>
                      <td className="py-2.5 pr-3">{s.rating ? <RatingBadge value={s.rating.overall} count={s.rating.ratings} /> : <span className="text-muted">—</span>}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">
                        {s.quotes}
                        {s.won > 0 && <p className="text-xs text-emerald-300">{s.won} {s.won === 1 ? "escolhido" : "escolhidos"}</p>}
                      </td>
                      {data.can.director && <td className="py-2.5">{s.bonus ? bonusText(s.bonus) : <span className="text-muted">—</span>}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="space-y-2 lg:hidden">
              {data.items.map((s) => (
                <li key={s.id}>
                  <Link href={`${base}/${s.id}`} className="block rounded-xl border border-border p-3 transition hover:border-primary/60">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 font-semibold">{s.tradeName || s.companyName}</p>
                      {s.rating && <RatingBadge value={s.rating.overall} count={s.rating.ratings} />}
                    </div>
                    <p className="text-xs text-muted">{formatCnpj(s.cnpj)}{s.city ? ` · ${[s.city, s.state].filter(Boolean).join("/")}` : ""}</p>
                    {s.categories.length > 0 && <p className="mt-1 text-sm text-muted">{s.categories.map((c) => CATEGORY[c].label).join(", ")}</p>}
                    <p className="mt-1 text-sm">
                      {s.quotes} {s.quotes === 1 ? "orçamento" : "orçamentos"}
                      {s.won > 0 && <span className="text-emerald-300"> · {s.won} {s.won === 1 ? "escolhido" : "escolhidos"}</span>}
                    </p>
                    {data.can.director && s.bonus && <p className="mt-1 text-sm">Bonificação: {bonusText(s.bonus)}</p>}
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
