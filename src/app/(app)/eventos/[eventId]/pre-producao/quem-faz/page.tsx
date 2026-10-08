import Link from "next/link";
import { requireUser } from "@/server/http/session";
import { notFound } from "next/navigation";
import { canUseField, canUsePreProduction } from "@/server/authz/policy";
import { listTeams } from "@/modules/teams/teams.service";
import { listParticipants } from "@/modules/participants/participants.service";
import { listServiceTypes } from "@/modules/service-types/service-types.service";
import { TopBar } from "@/components/top-bar";
import { EventTabs } from "@/components/event-nav";
import { EmptyState, PAGE, cx } from "@/components/ui";
import { Matrix } from "./matrix";
import { ProducersTabs } from "../funcoes/tabs";

export const metadata = { title: "Produtores e Funções" };

/** Aba de Produtores e Funções: planilha produtor × tipo de chamado, por equipe. */
export default async function WhoDoesWhatPage({ params, searchParams }: PageProps<"/eventos/[eventId]/pre-producao/quem-faz">) {
  const actor = await requireUser();
  const { eventId } = await params;
  const { equipe } = await searchParams;
  if (!canUsePreProduction(actor, eventId)) notFound();
  const [teams, types] = await Promise.all([listTeams(actor, eventId), listServiceTypes(actor, eventId)]);
  const withTypes = new Set(types.map((t) => t.teamId));
  const team = teams.find((t) => t.id === equipe) ?? teams.find((t) => withTypes.has(t.id)) ?? teams[0];
  const teamTypes = team ? types.filter((t) => t.teamId === team.id) : [];
  const people = team
    ? (await listParticipants(actor, eventId, { areaId: team.areaId })).filter(
        (p) => p.teamId === team.id || (!p.teamId && p.role === "HEAD"),
      )
    : [];
  const manage = !!team;

  return (
    <>
      <TopBar title="Produtores e Funções" subtitle={team ? `${team.area.name} › ${team.name}` : undefined} />
      {canUseField(actor, eventId) && <EventTabs eventId={eventId} active="pre" />}
      <ProducersTabs eventId={eventId} active="quem-faz" />
      <div className="z-10 bg-background">
        <div className={cx(PAGE, "flex gap-2 overflow-x-auto py-2")}>
          {teams.map((t) => (
            <Link
              key={t.id}
              href={`?equipe=${t.id}`}
              className={cx(
                "shrink-0 rounded-full border px-4 py-2 text-sm font-medium",
                t.id === team?.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface transition hover:border-primary/60",
              )}
            >
              {t.name}
            </Link>
          ))}
        </div>
      </div>
      <main className={cx(PAGE, "py-2 lg:py-4")}>
        {!team ? (
          <EmptyState title="Nenhuma equipe ainda">Monte as equipes primeiro em Montar equipe.</EmptyState>
        ) : teamTypes.length === 0 ? (
          <EmptyState title={`${team.name} ainda não tem tipos de atendimento`}>
            <Link href={`/eventos/${eventId}/pre-producao/tipos`} className="font-semibold text-primary">Cadastrar tipos em Tipos e SLA</Link>
          </EmptyState>
        ) : people.length === 0 ? (
          <EmptyState title={`Ninguém em ${team.name} ainda`}>Adicione pessoas em Montar equipe.</EmptyState>
        ) : (
          <Matrix
            eventId={eventId}
            manage={manage}
            types={teamTypes.map((t) => ({ id: t.id, name: t.name, slaMinutes: t.slaMinutes, peopleIds: t.peopleIds }))}
            people={people.map((p) => ({ id: p.id, name: p.name, jobTitle: p.jobTitle }))}
          />
        )}
      </main>
    </>
  );
}
