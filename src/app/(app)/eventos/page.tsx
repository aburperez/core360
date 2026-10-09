import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { isAgencyAdmin, isEventSupport } from "@/server/authz/actor";
import { listEvents } from "@/modules/events/events.service";
import { agenciesWithoutSupport } from "@/modules/agencies/agencies.service";
import { homePriorities, type Priority } from "@/modules/panels/panels.service";
import { TopBar } from "@/components/top-bar";
import { EmptyState, PAGE, cx } from "@/components/ui";
import { ROLE_LABEL, formatDate } from "@/lib/format";
import { EVENT_STATUS_LABEL as EVENT_STATUS } from "@/lib/event-stages";

export const metadata = { title: "Eventos" };


export default async function EventsPage({ searchParams }: PageProps<"/eventos">) {
  const actor = await requireUser();
  const events = await listEvents(actor);
  const { todos } = await searchParams;
  const admin = isAgencyAdmin(actor);
  // Quem só participa de um evento vai direto para ele (os diretores de produção veem a lista e o painel da agência).
  if (events.length === 1 && !todos && !admin && !actor.isPlatformAdmin) redirect(`/eventos/${events[0].id}`);
  const many = actor.adminAgencies.length > 1;
  const [noSupport, priorities] = await Promise.all([agenciesWithoutSupport(actor), homePriorities(actor, events)]);
  const urgent = events.filter((e) => priorities.get(e.id)?.length);

  return (
    <>
      <TopBar title="Meus eventos" subtitle={actor.name} brand />
      <main className={cx(PAGE, "grid gap-3 py-4 lg:grid-cols-2 lg:py-6 xl:grid-cols-3")}>
        {actor.isPlatformAdmin && (
          <Link href="/agencias" className="flex items-center justify-between gap-3 rounded-2xl border border-primary/40 bg-primary/5 p-4 lg:col-span-2 xl:col-span-3">
            <span className="min-w-0">
              <span className="block font-semibold">Agências</span>
              <span className="block text-sm text-muted">Criar, convidar o diretor de produção, suspender e reativar</span>
            </span>
            <span className="text-2xl text-primary">›</span>
          </Link>
        )}
        {actor.suspendedAgencies.map((a) => (
          <p key={a.id} className="rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-100 lg:col-span-2 xl:col-span-3">
            A agência <b>{a.name}</b> está suspensa. Os eventos dela voltam quando ela for reativada.
          </p>
        ))}
        {actor.adminAgencies.map((a) => {
          const q = many ? `?agencia=${a.id}` : "";
          return (
            <div key={a.id} className="rounded-2xl border border-primary/40 bg-primary/5 p-4 lg:col-span-2 xl:col-span-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{a.role === "SUPORTE" ? "Agência · você é Suporte" : "Agência · diretor de produção"}</p>
              <p className="text-lg font-semibold">{a.name}</p>
              {noSupport.has(a.id) && (
                <Link href={`/agencias/${a.id}`} className="mt-1 block text-sm text-amber-200 underline">
                  Autorize o Suporte CORE 360 para a gente poder ajudar quando algo der errado ›
                </Link>
              )}
              <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                <Link href={`/eventos/novo${q}`} className="col-span-2 inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 font-semibold text-primary-foreground sm:col-span-1">
                  + Novo evento
                </Link>
                <AdminLink href={`/clientes${q}`}>Clientes</AdminLink>
                <AdminLink href={`/diretores${q}`}>Diretores de produção</AdminLink>
                <AdminLink href={`/agencias/${a.id}`}>Suporte CORE 360</AdminLink>
              </div>
            </div>
          );
        })}
        {events.length === 0 && (
          <div className="lg:col-span-2 xl:col-span-3">
            {admin ? (
              <EmptyState title="Nenhum evento ainda">Cadastre um cliente e crie o primeiro evento.</EmptyState>
            ) : actor.isPlatformAdmin ? null : (
              <EmptyState title="Você ainda não está em nenhum evento">Peça ao gerente do evento para cadastrar você.</EmptyState>
            )}
          </div>
        )}
        {priorities.size > 0 && (
          <section className="rounded-2xl border border-border bg-surface p-4 lg:col-span-2 xl:col-span-3" aria-label="Prioridades de hoje">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Prioridades de hoje</h2>
            {urgent.length === 0 ? (
              <p className="mt-2 text-sm text-emerald-300">Nada atrasado nem vencendo hoje nos seus eventos.</p>
            ) : (
              <ul className="mt-2 divide-y divide-border/60">
                {urgent.map((e) => (
                  <li key={e.id} className="py-2.5 sm:flex sm:items-start sm:gap-4">
                    <Link href={`/eventos/${e.id}`} className="block font-semibold hover:text-primary sm:w-56 sm:shrink-0 sm:truncate">{e.name}</Link>
                    <PriorityChips items={priorities.get(e.id)!} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {events.map((e) => (
          <div key={e.id} className="relative rounded-2xl border border-border bg-surface p-4 transition hover:border-primary/60 active:scale-[0.99]">
          <Link href={`/eventos/${e.id}`} className="block after:absolute after:inset-0 after:rounded-2xl" aria-label={e.name}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold">{e.name}</p>
                <p className="truncate text-sm text-muted">{e.client.name}{e.venue ? ` · ${e.venue}` : ""}</p>
                <p className="mt-1 text-sm text-muted">{formatDate(e.startsAt)} – {formatDate(e.endsAt)}</p>
              </div>
              <div className="shrink-0 text-right">
                {e.myRole && (
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                    {isEventSupport(actor, e.id) ? "Suporte" : ROLE_LABEL[e.myRole]}
                  </span>
                )}
                <p className="mt-2 text-xs text-muted">{EVENT_STATUS[e.status]}</p>
              </div>
            </div>
          </Link>
          {!!priorities.get(e.id)?.length && <div className="relative mt-3"><PriorityChips items={priorities.get(e.id)!} /></div>}
          </div>
        ))}
      </main>
    </>
  );
}

function AdminLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-3 py-2 text-center leading-tight font-semibold">
      {children}
    </Link>
  );
}

/** Atrasado em vermelho, vence hoje em amarelo; cada um leva à tela onde se resolve. */
function PriorityChips({ items }: { items: Priority[] }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1.5 sm:mt-0">
      {items.map((p) => (
        <Link
          key={p.text}
          href={p.href}
          className={cx(
            "rounded-full px-2.5 py-1 text-xs font-semibold",
            p.tone === "red" ? "bg-red-500/15 text-red-300 hover:bg-red-500/25" : "bg-amber-400/15 text-amber-200 hover:bg-amber-400/25",
          )}
        >
          {p.text}
        </Link>
      ))}
    </div>
  );
}
