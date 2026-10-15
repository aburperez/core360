import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUsePreProduction } from "@/server/authz/policy";
import { getEvent } from "@/modules/events/events.service";
import { listQuotes, type QuoteStage } from "@/modules/quotes/quotes.service";
import { TopBar } from "@/components/top-bar";
import { PageHeading, Panel } from "@/components/panel";
import { Card, EmptyState, PAGE, cx } from "@/components/ui";
import { formatDateTime, slaText } from "@/lib/format";
import { brl } from "@/lib/money";
import { NewQuoteForm } from "./forms";
import { STAGE } from "./stage";
import { Browse } from "@/components/browse";

/** Bolinha de cada situação na grade do computador. */
const STAGE_DOT: Record<QuoteStage, string> = {
  RASCUNHO: "bg-gray-400",
  SEM_PRAZO: "bg-amber-400",
  NO_PRAZO: "bg-brand-cyan",
  ATRASADA: "bg-red-500",
  DECIDIR: "bg-violet-400",
  FECHADA: "bg-emerald-400",
  CANCELADA: "bg-gray-600",
};

export const metadata = { title: "Cotações" };

type Item = Awaited<ReturnType<typeof listQuotes>>["items"][number];

/**
 * Cotações do evento: o que precisa da pessoa primeiro (enviar, definir prazo,
 * escolher), depois o que está andando e o que já fechou.
 */
export default async function QuotesPage({ params }: PageProps<"/eventos/[eventId]/pre-producao/cotacoes">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!canUsePreProduction(actor, eventId)) notFound();
  const [event, data] = await Promise.all([getEvent(actor, eventId), listQuotes(actor, eventId)]);
  const base = `/eventos/${eventId}/pre-producao/cotacoes`;

  const needsMe = (q: Item) =>
    (q.mine && q.stage === "RASCUNHO") || (data.can.manage && (q.stage === "SEM_PRAZO" || q.stage === "DECIDIR")) || (q.mine && q.stage === "ATRASADA");
  const mineFirst = data.items.filter(needsMe);
  const open = data.items.filter((q) => !needsMe(q) && q.status !== "FECHADA" && q.status !== "CANCELADA");
  const done = data.items.filter((q) => q.status === "FECHADA" || q.status === "CANCELADA");
  const count = (s: QuoteStage) => data.items.filter((q) => q.stage === s).length;

  return (
    <>
      <TopBar title="Cotações" subtitle={event.name} back={`/eventos/${eventId}/pre-producao`} />
      <main className={cx(PAGE, "space-y-4 py-4 lg:py-6")}>
        <PageHeading trail={[event.name, "Pré-produção"]} title="Cotações">
          <NewQuoteForm eventId={eventId} people={data.people} costItems={data.costItems} me={data.me} />
        </PageHeading>
        <div className="lg:hidden">
          <NewQuoteForm eventId={eventId} people={data.people} costItems={data.costItems} me={data.me} />
        </div>

        <p className="text-sm text-muted">
          Até 3 orçamentos por pedido. Quem cuida envia o descritivo aos fornecedores, o gestor define o prazo e escolhe o orçamento no comparativo.
        </p>

        {data.items.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Count label="Sem prazo" value={count("SEM_PRAZO")} tone="text-amber-300" />
            <Count label="Recebendo" value={count("NO_PRAZO")} tone="text-brand-cyan" />
            <Count label="Prazo vencido" value={count("ATRASADA")} tone="text-red-300" />
            <Count label="Para escolher" value={count("DECIDIR")} tone="text-violet-200" />
          </div>
        )}

        {data.items.length === 0 ? (
          <EmptyState title="Nenhuma cotação ainda">
            Crie um pedido com o descritivo do que precisa. Ele vira o texto do e-mail para os fornecedores.
          </EmptyState>
        ) : (
          <>
          {/* Computador: grade estilo Protheus. Celular: grupos em cartões. */}
          <Browse
            title="Cotações"
            exportName="cotacoes"
            columns={[
              { key: "title", label: "Pedido", wrap: true },
              { key: "stage", label: "Situação" },
              { key: "responsible", label: "Quem cuida" },
              { key: "item", label: "Item do orçamento", wrap: true },
              { key: "count", label: "Orçamentos", align: "right" },
              { key: "min", label: "Menor valor", align: "right" },
              { key: "due", label: "Prazo" },
              { key: "closed", label: "Fechada em" },
            ]}
            rows={[...mineFirst, ...open, ...done].map((q) => {
              const sla = q.stage === "NO_PRAZO" || q.stage === "ATRASADA" ? slaText(q.dueAt) : null;
              return {
                id: q.id,
                href: `${base}/${q.id}`,
                dot: STAGE_DOT[q.stage],
                text: {
                  title: q.title,
                  stage: STAGE[q.stage].label + (needsMe(q) ? " · precisa de você" : ""),
                  responsible: q.responsible.name,
                  item: q.costItemName ?? "—",
                  count: `${q.count} de 3`,
                  min: q.minValue !== null ? brl(q.minValue) : "—",
                  due: sla ? sla.text : "—",
                  closed: q.stage === "FECHADA" && q.closedAt ? formatDateTime(q.closedAt) : "—",
                },
                cells: { due: sla ? <span className={sla.tone === "late" ? "font-semibold text-red-300" : undefined}>{sla.text}</span> : "—" },
              };
            })}
            legend={(Object.keys(STAGE_DOT) as QuoteStage[]).map((k) => ({ dot: STAGE_DOT[k], label: STAGE[k].label }))}
          />
          <div className="space-y-4 lg:hidden">
            {mineFirst.length > 0 && <Group title={`Precisa de você (${mineFirst.length})`} items={mineFirst} base={base} />}
            {open.length > 0 && <Group title={`Em andamento (${open.length})`} items={open} base={base} />}
            {done.length > 0 && <Group title={`Fechadas e canceladas (${done.length})`} items={done} base={base} />}
          </div>
          </>
        )}
      </main>
    </>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <Card className="p-3">
      <p className={cx("text-2xl font-bold tabular-nums", value ? tone : "text-muted")}>{value}</p>
      <p className="text-sm text-muted">{label}</p>
    </Card>
  );
}

function Group({ title, items, base }: { title: string; items: Item[]; base: string }) {
  return (
    <Panel title={title}>
      <ul className="divide-y divide-border">
        {items.map((q) => {
          const st = STAGE[q.stage];
          const sla = q.stage === "NO_PRAZO" || q.stage === "ATRASADA" ? slaText(q.dueAt) : null;
          return (
            <li key={q.id}>
              <Link href={`${base}/${q.id}`} className="flex flex-col gap-2 py-3 transition hover:text-primary sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{q.title}</span>
                  <span className="block truncate text-sm text-muted">
                    {q.responsible.name}
                    {q.costItemName ? ` · ${q.costItemName}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-full bg-white/5 px-2.5 py-1 tabular-nums">{q.count} de 3 orçamentos</span>
                  {q.minValue !== null && <span className="rounded-full bg-white/5 px-2.5 py-1 tabular-nums">menor {brl(q.minValue)}</span>}
                  {sla && <span className={cx("rounded-full px-2.5 py-1", sla.tone === "late" ? "bg-red-500/15 text-red-300" : "bg-white/5")}>{sla.text}</span>}
                  {q.stage === "FECHADA" && q.closedAt && <span className="text-muted">{formatDateTime(q.closedAt)}</span>}
                  <span className={cx("rounded-full px-2.5 py-1 font-semibold", st.tone)}>{st.label}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
