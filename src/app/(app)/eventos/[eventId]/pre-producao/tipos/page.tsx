import Link from "next/link";
import { requireUser } from "@/server/http/session";
import { notFound } from "next/navigation";
import { canReviewSla, canUseField, canUsePreProduction } from "@/server/authz/policy";
import { getEvent } from "@/modules/events/events.service";
import { listTeams } from "@/modules/teams/teams.service";
import { listServiceTypes } from "@/modules/service-types/service-types.service";
import { TopBar } from "@/components/top-bar";
import { EventTabs } from "@/components/event-nav";
import { Card, EmptyState, PAGE, SectionTitle, cx } from "@/components/ui";
import { formatDuration, formatDateTime } from "@/lib/format";
import { NewTypeForm } from "../sla-forms";

export const metadata = { title: "Tipos e SLA" };

/** Pré-produção: tipos de atendimento de cada equipe e o SLA de cada um. */
export default async function ServiceTypesPage({ params }: PageProps<"/eventos/[eventId]/pre-producao/tipos">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!canUsePreProduction(actor, eventId)) notFound();
  const [event, types, teams] = await Promise.all([getEvent(actor, eventId), listServiceTypes(actor, eventId), listTeams(actor, eventId)]);
  const base = `/eventos/${eventId}/pre-producao`;
  const creatable = teams;
  const toReview = canReviewSla(actor, eventId) ? types.filter((t) => t.pending) : [];

  return (
    <>
      <TopBar title="Tipos e SLA" subtitle={event.name} back={base} />
      {canUseField(actor, eventId) && <EventTabs eventId={eventId} active="pre" />}
      <main className={cx(PAGE, "py-4 lg:py-6")}>
        {toReview.length > 0 && (
          <>
            <SectionTitle>Aguardando sua revisão ({toReview.length})</SectionTitle>
            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
              {toReview.map((t) => (
                <Link key={t.id} href={`${base}/tipos/${t.id}`} className="block rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4 transition hover:border-amber-300">
                  <p className="font-semibold">{t.name}</p>
                  <p className="mt-1 text-sm text-muted">
                    {t.pending!.proposedBy.name} propôs <strong className="text-foreground">{formatDuration(t.pending!.minutes * 60)}</strong>
                    {t.slaMinutes ? ` (hoje: ${formatDuration(t.slaMinutes * 60)})` : ""}
                  </p>
                  <p className="mt-1 text-xs text-muted">{t.teamName} · {formatDateTime(t.pending!.createdAt)}</p>
                </Link>
              ))}
            </div>
          </>
        )}

        <SectionTitle>Tipos de atendimento e SLA</SectionTitle>
        <p className="mb-3 px-1 text-sm text-muted">
          O SLA de cada tipo vira o prazo do chamado de campo. O pré-produtor propõe e o gerente aprova, ajusta ou recusa.
          Sem SLA aprovado, vale o prazo da prioridade.
        </p>
        {creatable.length > 0 && (
          <div className="mb-3">
            <NewTypeForm eventId={eventId} teams={creatable.map((t) => ({ id: t.id, label: `${t.area.name} › ${t.name}` }))} />
          </div>
        )}

        {types.length === 0 ? (
          <EmptyState title="Nenhum tipo de atendimento ainda">
            {creatable.length ? "Crie o primeiro, por exemplo “Troca de lâmpada” na equipe de Elétrica." : "Monte as equipes primeiro em Montar equipe."}
          </EmptyState>
        ) : (
          <>
            {/* Computador: planilha. */}
            <Card className="hidden overflow-hidden p-0 lg:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Tipo de atendimento</th>
                    <th className="px-4 py-3 font-semibold">Equipe</th>
                    <th className="px-4 py-3 font-semibold">SLA</th>
                    <th className="px-4 py-3 font-semibold">Situação</th>
                    <th className="px-4 py-3 text-right font-semibold">Quem faz</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {types.map((t) => (
                    <tr key={t.id} className="transition hover:bg-white/5">
                      <td className="px-4 py-3">
                        <Link href={`${base}/tipos/${t.id}`} className="font-semibold hover:text-primary">{t.name}</Link>
                        {t.description && <p className="line-clamp-1 text-xs text-muted">{t.description}</p>}
                      </td>
                      <td className="px-4 py-3 text-muted">{t.areaName} › {t.teamName}</td>
                      <td className="px-4 py-3 font-semibold tabular-nums">{t.slaMinutes ? formatDuration(t.slaMinutes * 60) : "—"}</td>
                      <td className="px-4 py-3"><Situation t={t} /></td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted">{t.peopleIds.length || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            {/* Celular: cartões. */}
            <div className="space-y-3 lg:hidden">
              {types.map((t) => (
                <Link key={t.id} href={`${base}/tipos/${t.id}`} className="block rounded-2xl border border-border bg-surface p-4 active:scale-[0.99] transition">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 font-semibold">{t.name}</p>
                    <span className="shrink-0 font-semibold tabular-nums">{t.slaMinutes ? formatDuration(t.slaMinutes * 60) : "—"}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                    <span>{t.areaName} › {t.teamName}</span>
                    <Situation t={t} />
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </main>
    </>
  );
}

function Situation({ t }: { t: { slaMinutes: number | null; pending: { minutes: number } | null } }) {
  if (t.pending) return <span className="text-xs font-semibold text-amber-300">Proposta de {formatDuration(t.pending.minutes * 60)} aguardando</span>;
  if (t.slaMinutes) return <span className="text-xs text-emerald-300">Aprovado</span>;
  return <span className="text-xs text-muted">Sem SLA: usa a prioridade</span>;
}
