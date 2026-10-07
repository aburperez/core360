import { redirect } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUseField, canUsePreProduction } from "@/server/authz/policy";
import { isAgencyAdmin, isEventSupport } from "@/server/authz/actor";
import { getEvent } from "@/modules/events/events.service";
import { getDashboard } from "@/modules/dashboard/dashboard.service";
import { countMyPendingReceipts } from "@/modules/receipts/receipts.service";
import { myBriefingState } from "@/modules/briefings/briefings.service";
import { myPlanSummary } from "@/modules/functions/functions.service";
import Link from "next/link";
import { TopBar } from "@/components/top-bar";
import { EventTabs } from "@/components/event-nav";
import { Card, EmptyState, LinkButton, PAGE, SectionTitle, Stat, cx } from "@/components/ui";
import { OccurrenceCard, type OccurrenceRow } from "@/components/occurrence-card";
import { ROLE_LABEL, formatDuration } from "@/lib/format";

export const metadata = { title: "Início" };

export default async function DashboardPage({ params }: PageProps<"/eventos/[eventId]">) {
  const actor = await requireUser();
  const { eventId } = await params;
  // Pré-produtor não tem campo: a casa dele é a Pré-produção.
  if (!canUseField(actor, eventId)) redirect(`/eventos/${eventId}/pre-producao`);
  const [event, dash, toReceive, briefing, plan] = await Promise.all([
    getEvent(actor, eventId), getDashboard(actor, eventId), countMyPendingReceipts(actor, eventId), myBriefingState(actor, eventId),
    myPlanSummary(actor, eventId),
  ]);
  const base = `/eventos/${eventId}`;
  const scopeLabel =
    dash.role === "HEAD" ? "da sua área" : dash.role === "OPERACIONAL" ? "da sua equipe" : "do evento";
  const multi = actor.memberships.length > 1 || isAgencyAdmin(actor) || actor.isPlatformAdmin;

  return (
    <>
      <TopBar title={event.name} subtitle={`${isEventSupport(actor, eventId) ? "Suporte" : ROLE_LABEL[dash.role]} · ${actor.name}`} back={multi ? "/eventos?todos=1" : undefined} />
      {canUsePreProduction(actor, eventId) && <EventTabs eventId={eventId} active="campo" />}
      <main className={cx(PAGE, "py-4 lg:py-6")}>
        {(briefing === "NAO_LIDO" || briefing === "MUDOU") && (
          <Link
            href={`${base}/briefing`}
            className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-amber-400/50 bg-amber-400/10 p-4 transition hover:border-amber-300"
          >
            <span>
              <span className="block font-semibold">📋 {briefing === "MUDOU" ? "Seu briefing mudou" : "Leia seu briefing"}</span>
              <span className="block text-sm text-muted">O que você faz, onde e quando. Leia e confirme.</span>
            </span>
            <span className="text-2xl text-amber-300" aria-hidden>›</span>
          </Link>
        )}
        {(briefing === "LIDO" || (briefing === "SEM" && plan.has)) && (
          <Link href={`${base}/briefing`} className="mb-4 flex min-h-11 items-center gap-2 px-1 text-sm font-semibold text-primary lg:hidden">
            📋 Meu briefing
            {plan.pending > 0 && <span className="font-normal text-muted">· {plan.pending} {plan.pending === 1 ? "atividade" : "atividades"} a fazer</span>}
            <span aria-hidden>›</span>
          </Link>
        )}
        {toReceive > 0 && (
          <Link
            href={`${base}/recebimentos`}
            className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-primary/50 bg-primary/10 p-4 transition hover:border-primary"
          >
            <span>
              <span className="block font-semibold">📦 {toReceive === 1 ? "1 item para conferir" : `${toReceive} itens para conferir`}</span>
              <span className="block text-sm text-muted">A pré-produção enviou itens para você receber.</span>
            </span>
            <span className="text-2xl text-primary" aria-hidden>›</span>
          </Link>
        )}
        {"structure" in dash ? (
          <>
            <div className="grid grid-cols-3 gap-3 lg:max-w-2xl">
              <Stat label="Áreas" value={dash.structure.areas} />
              <Stat label="Equipes" value={dash.structure.teams} />
              <Stat label="Pessoas" value={dash.structure.people} />
            </div>
            <LinkButton href={`${base}/equipe`} className="mt-4 w-full lg:w-auto">Montar equipe</LinkButton>
          </>
        ) : (
          <>
            {/* Celular: o que está com a pessoa vem antes dos números. */}
            {dash.mine.length > 0 && <div className="lg:hidden"><Mine rows={dash.mine} eventId={eventId} /></div>}

            <SectionTitle>Ocorrências {scopeLabel}</SectionTitle>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              <Stat label="Urgentes" value={dash.totals.urgente} tone={dash.totals.urgente ? "text-red-400" : undefined} href={`${base}/ocorrencias?status=URGENTE`} />
              <Stat label="Bloqueios" value={dash.totals.bloqueio} tone={dash.totals.bloqueio ? "text-purple-300" : undefined} href={`${base}/ocorrencias?status=BLOQUEIO`} />
              <Stat label="Pendentes" value={dash.totals.pendente} href={`${base}/ocorrencias?status=PENDENTE`} />
              <Stat label="Em andamento" value={dash.totals.emAndamento} href={`${base}/ocorrencias?status=EM_ANDAMENTO`} />
              <Stat label="Concluídas" value={dash.totals.concluido} href={`${base}/ocorrencias?status=CONCLUIDO`} />
              <Stat label="Total" value={dash.totals.total} href={`${base}/ocorrencias?filtro=todas`} />
            </div>

            {/* Computador: chamados à esquerda, indicadores à direita. */}
            <div className="flex flex-col lg:grid lg:grid-cols-3 lg:grid-rows-[auto_1fr] lg:items-start lg:gap-x-6">
              <div className="order-2 lg:col-span-2 lg:col-start-1 lg:row-span-2 lg:row-start-1">
                {dash.mine.length > 0 && <div className="hidden lg:block"><Mine rows={dash.mine} eventId={eventId} /></div>}
                {dash.urgent.length > 0 && (
                  <>
                    <SectionTitle>Atenção</SectionTitle>
                    <div className="grid gap-3 xl:grid-cols-2">
                      {dash.urgent.map((o) => <OccurrenceCard key={o.id} o={o} eventId={eventId} />)}
                    </div>
                  </>
                )}
                {dash.totals.total === 0 && (
                  <div className="mt-4 lg:mt-6">
                    <EmptyState title="Nenhuma ocorrência ainda">Use o botão + para abrir a primeira.</EmptyState>
                  </div>
                )}
                {dash.mine.length === 0 && dash.urgent.length === 0 && dash.totals.total > 0 && (
                  <div className="mt-6 hidden lg:block">
                    <EmptyState title="Nada urgente agora">Nenhum chamado urgente, bloqueado ou com você.</EmptyState>
                  </div>
                )}
              </div>

              <div className="order-1 lg:col-start-3 lg:row-start-1">
                <SectionTitle>SLA</SectionTitle>
                <div className="grid grid-cols-3 gap-3 lg:grid-cols-1">
                  <Stat label="Tempo médio" value={<span className="text-2xl">{formatDuration(dash.sla.avgSeconds)}</span>} />
                  <Stat label="No prazo" value={dash.sla.concluded ? `${Math.round((dash.sla.onTime / dash.sla.concluded) * 100)}%` : "—"} />
                  <Stat label="Atrasadas abertas" value={dash.sla.breachedOpen} tone={dash.sla.breachedOpen ? "text-red-400" : undefined} />
                </div>
              </div>

              <div className="order-3 lg:col-start-3 lg:row-start-2">
                {dash.byArea.length > 1 && <Breakdown title="Por área" rows={dash.byArea} />}
                {dash.byTeam.length > 0 && <Breakdown title="Por equipe" rows={dash.byTeam} />}
              </div>
            </div>
          </>
        )}
        {(dash.role === "ADMIN" || dash.role === "GERENTE") && (
          <Link href={`${base}/editar`} className="mt-6 flex min-h-11 items-center gap-2 px-1 text-sm font-semibold text-primary">
            Dados do evento: nome, datas, local e fase <span aria-hidden>›</span>
          </Link>
        )}
      </main>
    </>
  );
}

function Mine({ rows, eventId }: { rows: OccurrenceRow[]; eventId: string }) {
  return (
    <>
      <SectionTitle>Comigo agora</SectionTitle>
      <div className="grid gap-3 xl:grid-cols-2">
        {rows.map((o) => <OccurrenceCard key={o.id} o={o} eventId={eventId} />)}
      </div>
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
