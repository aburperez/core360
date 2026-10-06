import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUseField, canUsePreProduction } from "@/server/authz/policy";
import { getEvent } from "@/modules/events/events.service";
import { listBriefings } from "@/modules/briefings/briefings.service";
import { TopBar } from "@/components/top-bar";
import { EventTabs } from "@/components/event-nav";
import { BriefingPill } from "@/components/briefing-view";
import { Card, EmptyState, PAGE, cx } from "@/components/ui";
import { ROLE_LABEL, formatDateTime } from "@/lib/format";

export const metadata = { title: "Briefing" };

type Person = Awaited<ReturnType<typeof listBriefings>>[number];

/** Briefing por pessoa: quem já tem, quem já leu, e atalho para a equipe toda. */
export default async function BriefingsPage({ params }: PageProps<"/eventos/[eventId]/pre-producao/briefing">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!canUsePreProduction(actor, eventId)) notFound();
  const [event, people] = await Promise.all([getEvent(actor, eventId), listBriefings(actor, eventId)]);
  const base = `/eventos/${eventId}/pre-producao/briefing`;

  // Gestão do evento primeiro, depois cada área e equipe.
  const groups = new Map<string, { label: string; teamId: string | null; people: Person[] }>();
  for (const p of people) {
    const key = p.role === "GERENTE" ? "0" : p.team ? `2${p.area?.name}${p.team.name}` : `1${p.area?.name ?? ""}`;
    const label = p.role === "GERENTE" ? "Gestão do evento" : p.team ? `${p.area?.name} › ${p.team.name}` : `${p.area?.name ?? "Sem área"} (Heads)`;
    if (!groups.has(key)) groups.set(key, { label, teamId: p.role === "GERENTE" ? null : (p.team?.id ?? null), people: [] });
    groups.get(key)!.people.push(p);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR")).map(([, g]) => g);
  const withBriefing = people.filter((p) => p.state !== "SEM").length;
  const read = people.filter((p) => p.state === "LIDO").length;

  return (
    <>
      <TopBar title="Briefing" subtitle={event.name} />
      {canUseField(actor, eventId) && <EventTabs eventId={eventId} active="pre" />}
      <main className={cx(PAGE, "py-4 lg:py-6")}>
        <p className="mb-3 px-1 text-sm text-muted">
          Escreva o que cada pessoa faz, onde e quando. Ela lê em &ldquo;Meu briefing&rdquo; e confirma.
          Os tipos de atendimento (de Quem faz o quê) e os contatos entram sozinhos.
        </p>
        {people.length === 0 ? (
          <EmptyState title="Ninguém do campo ainda">Monte as equipes primeiro em Montar equipe.</EmptyState>
        ) : (
          <>
            <p className="mb-4 px-1 text-sm">
              <strong className="tabular-nums">{withBriefing}</strong> de {people.length} com briefing ·{" "}
              <strong className="tabular-nums text-emerald-300">{read}</strong> já leram
            </p>
            <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
              {ordered.map((g) => (
                <Card key={g.label} className="p-0">
                  <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{g.label}</h2>
                    {g.teamId && (
                      <Link href={`${base}/equipe/${g.teamId}`} className="shrink-0 text-sm font-semibold text-primary">
                        Para a equipe toda
                      </Link>
                    )}
                  </div>
                  <ul className="divide-y divide-border">
                    {g.people.map((p) => (
                      <li key={p.id}>
                        <Link href={`${base}/${p.id}`} className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-white/5">
                          <span className="min-w-0">
                            <span className="block font-medium">{p.name}</span>
                            <span className="block truncate text-sm text-muted">
                              {p.jobTitle ?? ROLE_LABEL[p.role]}
                              {p.state === "LIDO" && p.briefing?.readAt ? ` · leu em ${formatDateTime(p.briefing.readAt)}` : ""}
                              {p.state === "SEM" ? "" : p.state !== "LIDO" && p.briefing ? ` · atualizado ${formatDateTime(p.briefing.updatedAt)}` : ""}
                            </span>
                          </span>
                          <BriefingPill state={p.state} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          </>
        )}
      </main>
    </>
  );
}
