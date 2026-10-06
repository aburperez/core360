import { requireUser } from "@/server/http/session";
import { membershipFor } from "@/server/authz/actor";
import { assignableRoles, canManageAreas, canManageTeams } from "@/server/authz/policy";
import { getEvent } from "@/modules/events/events.service";
import { listAreas } from "@/modules/areas/areas.service";
import { listTeams } from "@/modules/teams/teams.service";
import { listParticipants } from "@/modules/participants/participants.service";
import { TopBar } from "@/components/top-bar";
import { PAGE, cx } from "@/components/ui";
import { TeamBuilder } from "./team-builder";

export const metadata = { title: "Montar equipe" };

/**
 * Montar equipe: Evento → Área → Equipe → Pessoas numa tela só.
 * O que cada um pode criar/atribuir vem da mesma matriz usada pela API.
 */
export default async function TeamPage({ params }: PageProps<"/eventos/[eventId]/equipe">) {
  const actor = await requireUser();
  const { eventId } = await params;
  const [event, areas, teams, people] = await Promise.all([
    getEvent(actor, eventId),
    listAreas(actor, eventId),
    listTeams(actor, eventId),
    listParticipants(actor, eventId, { includeInactive: true }),
  ]);
  const me = membershipFor(actor, eventId);

  return (
    <>
      <TopBar title={assignableRoles(actor, eventId, me?.areaId).length ? "Montar equipe" : "Equipe"} subtitle={event.name} />
      <main className={cx(PAGE, "py-4 lg:py-6")}>
        <div className="lg:max-w-3xl">
          <TeamBuilder
            eventId={eventId}
            myUserId={actor.userId}
            canAddArea={canManageAreas(actor, eventId)}
            areas={areas.map((a) => ({
              id: a.id,
              name: a.name,
              canAddTeam: canManageTeams(actor, { eventId, areaId: a.id }),
              roles: assignableRoles(actor, eventId, a.id),
            }))}
            eventRoles={assignableRoles(actor, eventId, null)}
            teams={teams.map((t) => ({ id: t.id, name: t.name, areaId: t.areaId }))}
            people={people.map((p) => ({
              id: p.id, name: p.name, email: p.email, phone: p.phone, jobTitle: p.jobTitle, role: p.role,
              areaId: p.areaId, teamId: p.teamId, active: p.active, joined: !!p.userId, invited: !!p.invitedAt,
              mine: p.userId === actor.userId,
            }))}
          />
        </div>
      </main>
    </>
  );
}
