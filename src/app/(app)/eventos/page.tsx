import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { isAgencyAdmin, isEventSupport } from "@/server/authz/actor";
import { listEvents } from "@/modules/events/events.service";
import { agenciesWithoutSupport } from "@/modules/agencies/agencies.service";
import { homePriorities, type Priority } from "@/modules/panels/panels.service";
import { hasArchived } from "@/modules/closure/closure.service";
import { TopBar } from "@/components/top-bar";
import { EmptyState, PAGE, SectionTitle, cx } from "@/components/ui";
import { type TileData, SectionCard, SectionGrid } from "@/components/panel";
import { EventBrowser, type BrowserEvent } from "./event-browser";
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
  const [noSupport, priorities, archived] = await Promise.all([
    agenciesWithoutSupport(actor), homePriorities(actor, events), hasArchived(actor),
  ]);
  const urgent = events.filter((e) => priorities.get(e.id)?.length);

  const STAGE: Record<string, BrowserEvent["stage"]> = { MONTAGEM: "campo", EVENTO: "campo", DESMONTAGEM: "campo", FECHAMENTO: "fim", CONCLUIDO: "fim", CANCELADO: "fim" };
  const rows: BrowserEvent[] = events.map((e) => ({
    id: e.id, name: e.name, client: e.client.name,
    place: [e.venue, e.city].filter(Boolean).join(" · ") || null,
    dates: `${formatDate(e.startsAt)} – ${formatDate(e.endsAt)}`,
    status: EVENT_STATUS[e.status], stage: STAGE[e.status] ?? "pre",
    role: e.myRole ? (isEventSupport(actor, e.id) ? "Suporte" : ROLE_LABEL[e.myRole]) : null,
    type: e.eventType, audience: e.expectedAudience ? `${e.expectedAudience.toLocaleString("pt-BR")} pessoas` : null,
    description: e.description, priorities: priorities.get(e.id) ?? [],
  }));
  // Atalhos em cartões redondos, como as pastas do topo da referência.
  const one = actor.adminAgencies.length === 1 ? actor.adminAgencies[0] : null;
  const shortcuts: TileData[] = [
    ...(actor.isPlatformAdmin ? [{ href: "/agencias", icon: "agency" as const, title: "Agências", line: "Criar, convidar, suspender" }] : []),
    ...(one
      ? [
          { href: "/eventos/novo", icon: "plus" as const, title: "Novo evento", line: "Criar evento" },
          { href: "/clientes", icon: "client" as const, title: "Clientes", line: "Quem contrata a agência" },
          { href: "/diretores", icon: "team" as const, title: "Diretores", line: "Diretores de produção" },
          { href: "/inteligencia", icon: "sparkles" as const, title: "Inteligência", line: "Fornecedores e preços" },
          { href: `/agencias/${one.id}`, icon: "support" as const, title: "Suporte CORE 360", line: noSupport.has(one.id) ? "Autorize o suporte" : "Autorizado", alert: noSupport.has(one.id) },
        ]
      : []),
    ...(archived ? [{ href: "/encerrados", icon: "archive" as const, title: "Encerrados", line: "Resumo dos eventos apagados" }] : []),
  ];

  return (
    <>
      <TopBar title="Meus eventos" subtitle={actor.name} />
      <main className={cx(PAGE, "space-y-6 py-4 lg:py-6")}>
        <p className="text-muted">
          {one ? `Todos os eventos da ${one.name}. ` : ""}
          <span className="hidden lg:inline">Clique em um evento para ver os detalhes ao lado; dois cliques abrem.</span>
          <span className="lg:hidden">Toque em um evento para abrir.</span>
        </p>
        {actor.suspendedAgencies.map((a) => (
          <p key={a.id} className="rounded-xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-100">
            A agência <b>{a.name}</b> está suspensa. Os eventos dela voltam quando ela for reativada.
          </p>
        ))}
        {shortcuts.length > 0 && (
          <section>
            <SectionTitle>Atalhos</SectionTitle>
            <SectionGrid>
              {shortcuts.map((t, i) => <SectionCard key={t.href} href={t.href} icon={t.icon} title={t.title} line={t.line} tone={t.alert ? "alert" : undefined} i={i} />)}
            </SectionGrid>
          </section>
        )}
        {/* Mais de uma agência: um bloco de atalhos por agência. */}
        {!one && actor.adminAgencies.map((a) => {
          const q = `?agencia=${a.id}`;
          return (
            <section key={a.id}>
              <SectionTitle>{a.name} · {a.role === "SUPORTE" ? "você é Suporte" : "diretor de produção"}</SectionTitle>
              <SectionGrid>
                <SectionCard href={`/eventos/novo${q}`} icon="plus" title="Novo evento" line="Criar evento" i={0} />
                <SectionCard href={`/clientes${q}`} icon="client" title="Clientes" line="Quem contrata a agência" i={1} />
                <SectionCard href={`/diretores${q}`} icon="team" title="Diretores" line="Diretores de produção" i={2} />
                <SectionCard href={`/inteligencia${q}`} icon="sparkles" title="Inteligência" line="Fornecedores e preços" i={3} />
                <SectionCard href={`/agencias/${a.id}`} icon="support" title="Suporte CORE 360" line={noSupport.has(a.id) ? "Autorize o suporte" : "Autorizado"} tone={noSupport.has(a.id) ? "alert" : undefined} i={4} />
              </SectionGrid>
            </section>
          );
        })}
        {priorities.size > 0 && (
          <section className="rounded-xl border border-border bg-surface p-4" aria-label="Prioridades de hoje">
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted">Prioridades de hoje</h2>
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
        <section>
          <SectionTitle>Eventos</SectionTitle>
          {events.length === 0 ? (
            admin ? (
              <EmptyState title="Nenhum evento ainda">Cadastre um cliente e crie o primeiro evento.</EmptyState>
            ) : actor.isPlatformAdmin ? null : (
              <EmptyState title="Você ainda não está em nenhum evento">Peça ao gerente do evento para cadastrar você.</EmptyState>
            )
          ) : (
            <EventBrowser events={rows} />
          )}
        </section>
      </main>
    </>
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
