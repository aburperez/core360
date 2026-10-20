import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUseSection } from "@/server/authz/policy";
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
import { Browse } from "@/components/browse";

export const metadata = { title: "Fornecedores" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? undefined;

/**
 * Cadastro de fornecedores da agência: um por CNPJ, usado em todos os eventos.
 * A bonificação só aparece para o diretor.
 */
export default async function SuppliersPage({ params, searchParams }: PageProps<"/eventos/[eventId]/pre-producao/fornecedores">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!canUseSection(actor, eventId, "COTACOES")) notFound();
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
          <>
          {/* Computador: grade estilo Protheus. Celular: cartões. */}
          <Browse
            title="Fornecedores"
            exportName="fornecedores"
            columns={[
              { key: "name", label: "Nome fantasia" },
              { key: "company", label: "Razão social" },
              { key: "cnpj", label: "CNPJ" },
              { key: "contact", label: "Contato" },
              { key: "phone", label: "Telefone" },
              { key: "city", label: "Cidade/UF" },
              { key: "categories", label: "Categorias", wrap: true },
              { key: "rating", label: "Nota", align: "right" },
              { key: "quotes", label: "Orçamentos", align: "right" },
              ...(data.can.director ? [{ key: "bonus", label: "Bonificação" }] : []),
            ]}
            rows={data.items.map((s) => ({
              id: s.id,
              href: `${base}/${s.id}`,
              dot: !s.rating ? "bg-gray-400" : s.rating.overall >= 4 ? "bg-emerald-400" : s.rating.overall >= 3 ? "bg-amber-400" : "bg-red-500",
              text: {
                name: s.tradeName || s.companyName,
                company: s.companyName,
                cnpj: formatCnpj(s.cnpj),
                contact: s.contactName ?? "—",
                phone: s.phone ? formatPhone(s.phone) : "—",
                city: [s.city, s.state].filter(Boolean).join("/") || "—",
                categories: s.categories.map((c) => CATEGORY[c].label).join(", ") || "—",
                rating: s.rating ? s.rating.overall.toFixed(1).replace(".", ",") : "—",
                quotes: `${s.quotes}${s.won > 0 ? ` (${s.won} ${s.won === 1 ? "escolhido" : "escolhidos"})` : ""}`,
                bonus: s.bonus ? bonusText(s.bonus) : "—",
              },
              cells: { rating: s.rating ? <RatingBadge value={s.rating.overall} count={s.rating.ratings} /> : "—" },
            }))}
            legend={[
              { dot: "bg-emerald-400", label: "Nota 4 ou mais" },
              { dot: "bg-amber-400", label: "Nota de 3 a 4" },
              { dot: "bg-red-500", label: "Nota abaixo de 3" },
              { dot: "bg-gray-400", label: "Ainda sem avaliação" },
            ]}
          />
          <Panel title={`${data.items.length} ${data.items.length === 1 ? "fornecedor" : "fornecedores"}`} className="lg:hidden">
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
          </>
        )}
      </main>
    </>
  );
}
