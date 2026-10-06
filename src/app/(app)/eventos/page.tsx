import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { listEvents } from "@/modules/events/events.service";
import { TopBar } from "@/components/top-bar";
import { EmptyState, PAGE, cx } from "@/components/ui";
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
  // Quem só participa de um evento vai direto para ele (o Admin vê a lista e os diretores).
  if (events.length === 1 && !todos && !actor.isAdmin) redirect(`/eventos/${events[0].id}`);

  return (
    <>
      <TopBar title="Meus eventos" subtitle={actor.name} brand />
      <main className={cx(PAGE, "grid gap-3 py-4 lg:grid-cols-2 lg:py-6 xl:grid-cols-3")}>
        {actor.isAdmin && (
          <Link href="/diretores" className="flex items-center justify-between gap-3 rounded-2xl border border-primary/40 bg-primary/5 p-4 lg:col-span-2 xl:col-span-3">
            <span className="min-w-0">
              <span className="block font-semibold">Diretores de produção</span>
              <span className="block text-sm text-muted">Quem entra como Gerente em todos os eventos</span>
            </span>
            <span className="text-2xl text-primary">›</span>
          </Link>
        )}
        {events.length === 0 && (
          <div className="lg:col-span-2 xl:col-span-3">
            <EmptyState title="Você ainda não está em nenhum evento">Peça ao gerente do evento para cadastrar você.</EmptyState>
          </div>
        )}
        {events.map((e) => (
          <Link key={e.id} href={`/eventos/${e.id}`} className="block rounded-2xl border border-border bg-surface p-4 transition hover:border-primary/60 active:scale-[0.99]">
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
