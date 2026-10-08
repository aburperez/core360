import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { getEvent } from "@/modules/events/events.service";
import { getItem } from "@/modules/items/items.service";
import { CATEGORY, COST_CENTER_LABEL } from "@/modules/items/item-meta";
import { NotFoundError } from "@/server/errors";
import { TopBar } from "@/components/top-bar";
import { PageHeading, Panel } from "@/components/panel";
import { PAGE, cx } from "@/components/ui";
import { ItemStatusPill } from "../status-pill";
import { ItemForm } from "./item-form";

export const metadata = { title: "Item do evento" };

const QUOTE_STATUS = { ABERTA: "Rascunho", ENVIADA: "Enviada", FECHADA: "Fechada", CANCELADA: "Cancelada" } as const;

/** Um item do evento: os dados de produção (sem valores) e as cotações dele. */
export default async function ItemPage({ params }: PageProps<"/eventos/[eventId]/pre-producao/itens/[itemId]">) {
  const actor = await requireUser();
  const { eventId, itemId } = await params;
  const data = await getItem(actor, itemId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  if (data.eventId !== eventId) notFound();
  const event = await getEvent(actor, eventId);
  const { item } = data;
  const map = `/eventos/${eventId}/pre-producao/itens`;

  return (
    <>
      <TopBar title={item.code} subtitle={item.name} back={map} />
      <main className={cx(PAGE, "space-y-4 py-4 lg:py-6")}>
        <PageHeading trail={[event.name, "Pré-produção", "Mapa de itens"]} title={item.name} />
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg bg-white/10 px-2.5 py-1 font-mono text-sm">{item.code}</span>
          <ItemStatusPill status={item.status} />
          <span className="text-sm text-muted">Na planilha: {item.sectionName}</span>
        </div>

        <div className="gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_320px]">
          <Panel title="Dados do item">
            <ItemForm item={item} areas={data.areas} people={data.people} others={data.others} can={data.can} />
          </Panel>
          <aside className="mt-4 space-y-4 lg:mt-0">
            <Panel title="Resumo">
              <dl className="space-y-2 text-sm">
                <Row label="Categoria">{item.category ? CATEGORY[item.category].label : "Sem categoria"}</Row>
                <Row label="Centro de custo">
                  {item.costCenter ? COST_CENTER_LABEL[item.costCenter] : "—"}
                  {item.costCenter && !item.costCenterChosen && <span className="text-muted"> (da categoria)</span>}
                </Row>
                <Row label="Fornecedor">{item.supplier ?? <span className="text-muted">Sai da cotação, quando o diretor escolher</span>}</Row>
              </dl>
              {item.description && (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-primary">Descritivo da planilha</summary>
                  <p className="mt-1 whitespace-pre-line text-muted">{item.description}</p>
                </details>
              )}
            </Panel>
            <Panel title="Cotações deste item">
              {data.quotes.length === 0 ? (
                <p className="text-sm text-muted">
                  Nenhuma ainda. Ao abrir uma cotação ligada a este item, o status muda sozinho: Em cotação quando ela é enviada,
                  Cotação recebida no primeiro orçamento, Em aprovação com os 3 e Aprovado quando o diretor escolhe.
                </p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {data.quotes.map((q) => (
                    <li key={q.id} className="flex justify-between gap-2">
                      <Link href={`/eventos/${eventId}/pre-producao/cotacoes/${q.id}`} className="min-w-0 truncate text-primary hover:underline">{q.title}</Link>
                      <span className="shrink-0 text-muted">{QUOTE_STATUS[q.status]}</span>
                    </li>
                  ))}
                </ul>
              )}
              <Link href={`/eventos/${eventId}/pre-producao/cotacoes`} className="mt-3 inline-block text-sm text-primary underline">Ir para Cotações</Link>
            </Panel>
          </aside>
        </div>
      </main>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
