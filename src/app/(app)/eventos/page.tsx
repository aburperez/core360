import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { listEvents } from "@/modules/events/events.service";
import { TopBar } from "@/components/top-bar";
import { EmptyState } from "@/components/ui";
import { ROLE_LABEL, formatDate } from "@/lib/format";

export const metadata = { title: "Eventos" };

const EVENT_STATUS: Record<string, string> = {
  PLANEJAMENTO: "Planejamento", PRE_PRODUCAO: "Pré-produção", MONTAGEM: "Montagem", OPERACAO: "Operação",
  DESMONTAGEM: "Desmontagem", FINALIZADO: "Finalizado", CANCELADO: "Cancelado",
};

export default async function EventsPage({ searchParams }: PageProps<"/eventos">) {
  const actor = await requireUser();
  const events = await listEvents(actor);
  const { todos } = await searchParams;
  // Quem só participa de um evento vai direto para ele.
  if (events.length === 1 && !todos) redirect(`/eventos/${events[0].id}`);

  return (
    <>
      <TopBar title="Meus eventos" subtitle={actor.name} />
      <main className="mx-auto max-w-2xl space-y-3 px-4 py-4">
        {events.length === 0 && (
          <EmptyState title="Você ainda não está em nenhum evento">Peça ao gerente do evento para cadastrar você.</EmptyState>
        )}
        {events.map((e) => (
          <Link key={e.id} href={`/eventos/${e.id}`} className="block rounded-2xl border border-border bg-surface p-4 active:scale-[0.99] transition">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold">{e.name}</p>
                <p className="truncate text-sm text-muted">{e.client.name}{e.venue ? ` · ${e.venue}` : ""}</p>
                <p className="mt-1 text-sm text-muted">{formatDate(e.startsAt)} – {formatDate(e.endsAt)}</p>
              </div>
              <div className="shrink-0 text-right">
                {e.myRole && <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">{ROLE_LABEL[e.myRole]}</span>}
                <p className="mt-2 text-xs text-muted">{EVENT_STATUS[e.status]}</p>
              </div>
            </div>
          </Link>
        ))}
      </main>
    </>
  );
}
