import Link from "next/link";
import { requireUser } from "@/server/http/session";
import { isClient } from "@/server/authz/policy";
import { listOccurrences } from "@/modules/occurrences/occurrences.service";
import { TopBar } from "@/components/top-bar";
import { EmptyState, PAGE, cx } from "@/components/ui";
import { OccurrenceCard } from "@/components/occurrence-card";
import { Browse, BrowseFilter, toolPrimary, type BrowseRow } from "@/components/browse";
import { Icon } from "@/components/icons";
import { PRIORITY_LABEL, STATUS_LABEL, formatDateTime, slaText } from "@/lib/format";
import { PriorityText, SlaPill } from "@/components/ui";

/** Cor da bolinha de cada situação na grade do computador (mesmas cores das etiquetas). */
const STATUS_DOT = {
  URGENTE: "bg-red-500",
  BLOQUEIO: "bg-purple-400",
  PENDENTE: "bg-amber-400",
  EM_ANDAMENTO: "bg-brand-cyan",
  CONCLUIDO: "bg-emerald-400",
  CANCELADO: "bg-gray-400",
} as const;

export const metadata = { title: "Chamados" };

const FILTERS = [
  { key: "abertas", label: "Abertas", q: { open: "true" } },
  { key: "minhas", label: "Minhas", q: { mine: "true", open: "true" } },
  { key: "urgentes", label: "Urgentes", q: { status: "URGENTE" } },
  { key: "bloqueios", label: "Bloqueios", q: { status: "BLOQUEIO" } },
  { key: "concluidas", label: "Concluídas", q: { status: "CONCLUIDO" } },
  { key: "todas", label: "Todas", q: {} },
] as const;

export default async function OccurrencesPage({ params, searchParams }: PageProps<"/eventos/[eventId]/ocorrencias">) {
  const actor = await requireUser();
  const { eventId } = await params;
  const sp = await searchParams;
  const status = typeof sp.status === "string" ? sp.status : undefined;
  const key = typeof sp.filtro === "string" ? sp.filtro : status ? FILTERS.find((f) => "status" in f.q && f.q.status === status)?.key : "abertas";
  const filter = FILTERS.find((f) => f.key === key) ?? { key: "status", label: status, q: { status } };
  const items = await listOccurrences(actor, eventId, filter.q);
  const watching = isClient(actor, eventId);
  const base = `/eventos/${eventId}/ocorrencias`;
  const filters = FILTERS.filter((f) => !watching || f.key !== "minhas");
  const rows: BrowseRow[] = items.map((o) => {
    const closed = o.status === "CONCLUIDO" || o.status === "CANCELADO";
    const sla = slaText(o.slaDueAt);
    return {
      id: o.id,
      href: `${base}/${o.id}`,
      dot: STATUS_DOT[o.status],
      text: {
        number: String(o.number).padStart(4, "0"),
        title: o.title,
        status: STATUS_LABEL[o.status],
        area: o.area?.name ?? "—",
        team: o.team?.name ?? "—",
        priority: PRIORITY_LABEL[o.priority],
        responsible: o.responsible?.name ?? "—",
        opened: formatDateTime(o.openedAt),
        sla: closed || sla.tone === "none" ? "—" : sla.text,
        photos: o._count.attachments ? String(o._count.attachments) : "",
      },
      cells: {
        priority: <PriorityText priority={o.priority} />,
        sla: closed ? "—" : <SlaPill dueAt={o.slaDueAt} />,
      },
    };
  });

  return (
    <>
      <TopBar title="Chamados" subtitle={`${items.length} ${items.length === 1 ? "item" : "itens"}${watching ? " · só acompanhamento" : ""}`} />
      <div className="sticky top-[calc(4rem+env(safe-area-inset-top))] z-10 bg-background lg:hidden">
        <div className={cx(PAGE, "flex gap-2 overflow-x-auto py-2")}>
          {filters.map((f) => (
            <Link
              key={f.key}
              href={`?filtro=${f.key}`}
              className={cx(
                "shrink-0 rounded-full border px-4 py-2 text-sm font-medium",
                filter.key === f.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface transition hover:border-primary/60",
              )}
            >
              {f.label}
            </Link>
          ))}
        </div>
      </div>
      {/* Computador: grade estilo Protheus. Celular: cartões. */}
      <div className={cx(PAGE, "hidden py-2 lg:block")}>
        <Browse
          title="Chamados"
          exportName="chamados"
          columns={[
            { key: "number", label: "Nº", width: "64px" },
            { key: "title", label: "Título", wrap: true },
            { key: "status", label: "Situação" },
            { key: "area", label: "Área" },
            { key: "team", label: "Equipe" },
            { key: "priority", label: "Prioridade" },
            { key: "responsible", label: "Responsável" },
            { key: "opened", label: "Aberto" },
            { key: "sla", label: "SLA" },
            { key: "photos", label: "Fotos", align: "center", width: "56px" },
          ]}
          rows={rows}
          legend={(Object.keys(STATUS_DOT) as (keyof typeof STATUS_DOT)[]).map((k) => ({ dot: STATUS_DOT[k], label: STATUS_LABEL[k] }))}
          filters={
            <BrowseFilter
              label="Situação"
              value={filter.key}
              options={[
                ...filters.map((f) => ({ value: f.key, label: f.label, href: `?filtro=${f.key}` })),
                ...(filters.some((f) => f.key === filter.key) ? [] : [{ value: filter.key, label: filter.label ?? "", href: "" }]),
              ]}
            />
          }
          actions={
            !watching && (
              <Link href={`${base}/nova`} className={toolPrimary}>
                <Icon name="plus" className="h-4 w-4" /> Novo chamado
              </Link>
            )
          }
          empty={`Nenhum chamado em "${filter.label ?? STATUS_LABEL[status as keyof typeof STATUS_LABEL]}".`}
        />
      </div>
      <main className={cx(PAGE, "grid gap-3 py-2 lg:hidden")}>
        {items.length === 0 && (
          <div>
            <EmptyState title="Nada por aqui">
              {`Nenhum chamado em "${filter.label ?? STATUS_LABEL[status as keyof typeof STATUS_LABEL]}".`}
            </EmptyState>
          </div>
        )}
        {items.map((o) => <OccurrenceCard key={o.id} o={o} eventId={eventId} />)}
      </main>
    </>
  );
}
