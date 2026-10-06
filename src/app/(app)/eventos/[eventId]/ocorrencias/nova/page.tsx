import { requireUser } from "@/server/http/session";
import { membershipFor } from "@/server/authz/actor";
import { canCreateOccurrence } from "@/server/authz/policy";
import { listTeams } from "@/modules/teams/teams.service";
import { listParticipants } from "@/modules/participants/participants.service";
import { listServiceTypesForTickets } from "@/modules/service-types/service-types.service";
import { TopBar } from "@/components/top-bar";
import { EmptyState, PAGE, cx } from "@/components/ui";
import { NewOccurrenceForm } from "./new-occurrence-form";

export const metadata = { title: "Nova ocorrência" };

export default async function NewOccurrencePage({ params }: PageProps<"/eventos/[eventId]/ocorrencias/nova">) {
  const actor = await requireUser();
  const { eventId } = await params;
  const me = membershipFor(actor, eventId);
  const teams = (await listTeams(actor, eventId)).filter((t) =>
    canCreateOccurrence(actor, { eventId, areaId: t.areaId, teamId: t.id }),
  );
  const people = (await listParticipants(actor, eventId)).filter((p) => p.userId || p.teamId);
  const types = await listServiceTypesForTickets(actor, eventId);

  return (
    <>
      <TopBar title="Nova ocorrência" back={`/eventos/${eventId}/ocorrencias`} />
      <main className={cx(PAGE, "py-4 lg:py-6")}>
        <div className="lg:max-w-2xl">
          {teams.length === 0 ? (
            <EmptyState title="Você não abre ocorrências neste evento" />
          ) : (
            <NewOccurrenceForm
              eventId={eventId}
              teams={teams.map((t) => ({ id: t.id, name: t.name, area: t.area.name }))}
              defaultTeamId={me?.teamId ?? (teams.length === 1 ? teams[0].id : "")}
              people={people.map((p) => ({ id: p.id, name: p.name, teamId: p.teamId, jobTitle: p.jobTitle }))}
              meParticipantId={me?.participantId ?? null}
              types={types.map((t) => ({ id: t.id, name: t.name, teamId: t.teamId, slaMinutes: t.slaMinutes }))}
            />
          )}
        </div>
      </main>
    </>
  );
}
