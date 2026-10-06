import Link from "next/link";
import { requireUser } from "@/server/http/session";
import { membershipFor } from "@/server/authz/actor";
import { listOccurrences } from "@/modules/occurrences/occurrences.service";
import { TopBar } from "@/components/top-bar";
import { EmptyState, cx } from "@/components/ui";
import { OccurrenceCard } from "@/components/occurrence-card";
import { STATUS_LABEL } from "@/lib/format";

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
  const isClient = membershipFor(actor, eventId)?.role === "CLIENTE" && !actor.isAdmin;

  return (
    <>
      <TopBar title="Chamados" subtitle={`${items.length} ${items.length === 1 ? "item" : "itens"}`} />
      <div className="sticky top-[calc(4rem+env(safe-area-inset-top))] z-10 bg-background">
        <div className="mx-auto flex max-w-2xl gap-2 overflow-x-auto px-4 py-2">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={`?filtro=${f.key}`}
              className={cx(
                "shrink-0 rounded-full border px-4 py-2 text-sm font-medium",
                filter.key === f.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface",
              )}
            >
              {f.label}
            </Link>
          ))}
        </div>
      </div>
      <main className="mx-auto max-w-2xl space-y-3 px-4 py-2">
        {items.length === 0 && (
          <EmptyState title={isClient ? "Ocorrências são internas da operação" : "Nada por aqui"}>
            {isClient ? "Como cliente, você acompanha a estrutura e a equipe do evento." : `Nenhum chamado em "${filter.label ?? STATUS_LABEL[status as keyof typeof STATUS_LABEL]}".`}
          </EmptyState>
        )}
        {items.map((o) => <OccurrenceCard key={o.id} o={o} eventId={eventId} />)}
      </main>
    </>
  );
}
