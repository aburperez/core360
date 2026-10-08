import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUsePreProduction } from "@/server/authz/policy";
import { getEvent } from "@/modules/events/events.service";
import { listItemMap, type MapItem } from "@/modules/items/items.service";
import { CATEGORY, ITEM_STATUS_LABEL, ITEM_STATUSES } from "@/modules/items/item-meta";
import { decimal } from "@/lib/money";
import { TopBar } from "@/components/top-bar";
import { PageHeading, Panel } from "@/components/panel";
import { EmptyState, LinkButton, PAGE, cx } from "@/components/ui";
import { ItemFilters } from "./filters";
import { ItemStatusPill } from "./status-pill";

export const metadata = { title: "Mapa de itens" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
const br = (day: string | null) => (day ? `${day.slice(8, 10)}/${day.slice(5, 7)}` : "—");

/**
 * Mapa de itens: todos os itens do evento com código, área, responsável,
 * data, local, fornecedor e status. Sem valores (os valores ficam em Custos).
 */
export default async function ItemMapPage({ params, searchParams }: PageProps<"/eventos/[eventId]/pre-producao/itens">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!canUsePreProduction(actor, eventId)) notFound();
  const q = await searchParams;
  const [event, data] = await Promise.all([
    getEvent(actor, eventId),
    listItemMap(actor, eventId, { area: one(q.area), status: one(q.status), responsible: one(q.responsavel), category: one(q.categoria) }),
  ]);
  const base = `/eventos/${eventId}/pre-producao/itens`;
  const filtered = Object.values(data.filters).some(Boolean);
  const costs = `/eventos/${eventId}/pre-producao/custos`;

  return (
    <>
      <TopBar title="Mapa de itens" subtitle={event.name} back={`/eventos/${eventId}/pre-producao`} />
      <main className={cx(PAGE, "space-y-4 py-4 lg:py-6")}>
        <PageHeading trail={[event.name, "Pré-produção"]} title="Mapa de itens">
          <LinkButton href={costs} variant="secondary">Novo item na planilha</LinkButton>
        </PageHeading>
        <p className="text-sm text-muted">
          Cada item da planilha Padrão CORE 360, com quem cuida, quando precisa, onde fica e em que pé está. Aqui não aparecem valores (eles ficam no Orçamento).
          Toque num item para mudar a área, a categoria, o responsável, a data, o local ou o status.
        </p>

        {data.total === 0 ? (
          <EmptyState title="Nenhum item ainda">
            Os itens nascem na planilha Padrão CORE 360. Monte ou importe a planilha e eles aparecem aqui com o código de cada um.
            <div className="mt-3"><LinkButton href={costs}>Abrir a planilha</LinkButton></div>
          </EmptyState>
        ) : (
          <>
            <Panel title={`Status (${data.total} ${data.total === 1 ? "item" : "itens"})`}>
              <div className="flex flex-wrap gap-2">
                {ITEM_STATUSES.filter((s) => data.byStatus[s]).map((s) => (
                  <Link
                    key={s}
                    href={data.filters.status === s ? base : `${base}?status=${s}`}
                    aria-current={data.filters.status === s ? "true" : undefined}
                    className={cx("rounded-full border px-3 py-1 text-sm transition",
                      data.filters.status === s ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/60")}
                  >
                    {ITEM_STATUS_LABEL[s]} <strong className="tabular-nums">{data.byStatus[s]}</strong>
                  </Link>
                ))}
              </div>
            </Panel>

            <ItemFilters areas={data.areas} people={data.people} />

            {data.items.length === 0 ? (
              <EmptyState title="Nenhum item com estes filtros">
                <Link href={base} className="text-primary underline">Limpar os filtros</Link>
              </EmptyState>
            ) : (
              <>
                {filtered && (
                  <p className="text-sm text-muted">
                    {data.items.length} de {data.total} itens · <Link href={base} className="text-primary underline">limpar filtros</Link>
                  </p>
                )}
                <ItemTable items={data.items} base={base} />
                <ul className="space-y-2 lg:hidden">
                  {data.items.map((i) => <ItemCard key={i.id} i={i} base={base} />)}
                </ul>
              </>
            )}
          </>
        )}
      </main>
    </>
  );
}

const qty = (i: MapItem) => `${decimal(i.quantity)}${i.unit ? ` ${i.unit}` : ""}`;

function ItemTable({ items, base }: { items: MapItem[]; base: string }) {
  return (
    <div className="hidden overflow-hidden rounded-2xl border border-border bg-surface lg:block">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
          <tr>
            {["Código", "Item", "Área", "Qtd.", "Responsável", "Data", "Local", "Fornecedor", "Status"].map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((i) => (
            <tr key={i.id} className="hover:bg-white/5">
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                <Link href={`${base}/${i.id}`} className="text-primary hover:underline">{i.code}</Link>
              </td>
              <td className="max-w-64 px-3 py-2">
                <Link href={`${base}/${i.id}`} className="font-medium hover:underline">{i.name}</Link>
                <p className="truncate text-xs text-muted">{i.category ? CATEGORY[i.category].label : "Sem categoria"}</p>
              </td>
              <td className="px-3 py-2">{i.areaName ?? <span className="text-muted">—</span>}</td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">{qty(i)}</td>
              <td className="px-3 py-2">{i.responsibleName ?? <span className="text-muted">—</span>}</td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">{br(i.neededOn)}</td>
              <td className="px-3 py-2">{i.location ?? <span className="text-muted">—</span>}</td>
              <td className="px-3 py-2">{i.supplier ?? <span className="text-muted">—</span>}</td>
              <td className="px-3 py-2"><ItemStatusPill status={i.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ItemCard({ i, base }: { i: MapItem; base: string }) {
  return (
    <li>
      <Link href={`${base}/${i.id}`} className="block rounded-2xl border border-border bg-surface p-3 transition hover:border-primary/60">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-mono text-xs text-primary">{i.code}</p>
            <p className="font-semibold">{i.name}</p>
          </div>
          <ItemStatusPill status={i.status} />
        </div>
        <p className="mt-1 text-sm text-muted">
          {[qty(i), i.areaName, i.location, i.neededOn && `até ${br(i.neededOn)}`].filter(Boolean).join(" · ")}
        </p>
        <p className="text-sm text-muted">
          {[i.responsibleName ? `Responsável: ${i.responsibleName}` : "Sem responsável", i.supplier].filter(Boolean).join(" · ")}
        </p>
      </Link>
    </li>
  );
}
