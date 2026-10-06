import { requireUser } from "@/server/http/session";
import { getEvent } from "@/modules/events/events.service";
import { getDashboard } from "@/modules/dashboard/dashboard.service";
import { TopBar } from "@/components/top-bar";
import { Card, EmptyState, LinkButton, SectionTitle, Stat } from "@/components/ui";
import { OccurrenceCard } from "@/components/occurrence-card";
import { ROLE_LABEL, formatDuration } from "@/lib/format";

export const metadata = { title: "Início" };

export default async function DashboardPage({ params }: PageProps<"/eventos/[eventId]">) {
  const actor = await requireUser();
  const { eventId } = await params;
  const [event, dash] = await Promise.all([getEvent(actor, eventId), getDashboard(actor, eventId)]);
  const base = `/eventos/${eventId}`;
  const scopeLabel =
    dash.role === "HEAD" ? "da sua área" : dash.role === "OPERACIONAL" ? "da sua equipe" : "do evento";
  const multi = actor.memberships.length > 1 || actor.isAdmin;

  return (
    <>
      <TopBar title={event.name} subtitle={`${ROLE_LABEL[dash.role]} · ${actor.name}`} back={multi ? "/eventos?todos=1" : undefined} />
      <main className="mx-auto max-w-2xl px-4 py-4">
        {"structure" in dash ? (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Áreas" value={dash.structure.areas} />
              <Stat label="Equipes" value={dash.structure.teams} />
              <Stat label="Pessoas" value={dash.structure.people} />
            </div>
            <LinkButton href={`${base}/equipe`} className="mt-4 w-full">Montar equipe</LinkButton>
          </>
        ) : (
          <>
            {dash.mine.length > 0 && (
              <>
                <SectionTitle>Comigo agora</SectionTitle>
                <div className="space-y-3">
                  {dash.mine.map((o) => <OccurrenceCard key={o.id} o={o} eventId={eventId} />)}
                </div>
              </>
            )}

            <SectionTitle>Ocorrências {scopeLabel}</SectionTitle>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat label="Urgentes" value={dash.totals.urgente} tone={dash.totals.urgente ? "text-red-600 dark:text-red-400" : undefined} href={`${base}/ocorrencias?status=URGENTE`} />
              <Stat label="Bloqueios" value={dash.totals.bloqueio} tone={dash.totals.bloqueio ? "text-purple-700 dark:text-purple-300" : undefined} href={`${base}/ocorrencias?status=BLOQUEIO`} />
              <Stat label="Pendentes" value={dash.totals.pendente} href={`${base}/ocorrencias?status=PENDENTE`} />
              <Stat label="Em andamento" value={dash.totals.emAndamento} href={`${base}/ocorrencias?status=EM_ANDAMENTO`} />
              <Stat label="Concluídas" value={dash.totals.concluido} href={`${base}/ocorrencias?status=CONCLUIDO`} />
              <Stat label="Total" value={dash.totals.total} href={`${base}/ocorrencias?filtro=todas`} />
            </div>

            <SectionTitle>SLA</SectionTitle>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Tempo médio" value={<span className="text-2xl">{formatDuration(dash.sla.avgSeconds)}</span>} />
              <Stat label="No prazo" value={dash.sla.concluded ? `${Math.round((dash.sla.onTime / dash.sla.concluded) * 100)}%` : "—"} />
              <Stat label="Atrasadas abertas" value={dash.sla.breachedOpen} tone={dash.sla.breachedOpen ? "text-red-600 dark:text-red-400" : undefined} />
            </div>

            {dash.urgent.length > 0 && (
              <>
                <SectionTitle>Atenção</SectionTitle>
                <div className="space-y-3">
                  {dash.urgent.map((o) => <OccurrenceCard key={o.id} o={o} eventId={eventId} />)}
                </div>
              </>
            )}

            {dash.byArea.length > 1 && <Breakdown title="Por área" rows={dash.byArea} />}
            {dash.byTeam.length > 0 && <Breakdown title="Por equipe" rows={dash.byTeam} />}

            {dash.totals.total === 0 && (
              <div className="mt-4">
                <EmptyState title="Nenhuma ocorrência ainda">Use o botão + para abrir a primeira.</EmptyState>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}

function Breakdown({ title, rows }: { title: string; rows: { id: string; name: string; total: number; open: number }[] }) {
  const max = Math.max(...rows.map((r) => r.total), 1);
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      <Card className="space-y-3">
        {rows.map((r) => (
          <div key={r.id}>
            <div className="flex justify-between text-sm">
              <span className="font-medium">{r.name}</span>
              <span className="tabular-nums text-muted">
                <strong className="text-foreground">{r.open}</strong> abertas · {r.total}
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-border">
              <div className="h-full rounded-full bg-primary" style={{ width: `${(r.total / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </Card>
    </>
  );
}
