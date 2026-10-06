import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canSeeEvent, canBuildTeam } from "@/server/authz/policy";
import { membershipFor } from "@/server/authz/actor";
import { EventNav } from "@/components/event-nav";

export default async function EventLayout({ children, params }: LayoutProps<"/eventos/[eventId]">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!canSeeEvent(actor, eventId)) notFound();
  const role = actor.isAdmin ? "ADMIN" : membershipFor(actor, eventId)?.role;
  return (
    <div className="pb-nav lg:pb-0 lg:pl-60">
      {children}
      <EventNav
        eventId={eventId}
        canCreate={role !== "CLIENTE"}
        canSeeTickets={role !== "CLIENTE"}
        canBuildTeam={canBuildTeam(actor, eventId)}
        canSwitchEvent={actor.memberships.length > 1 || actor.isAdmin}
      />
    </div>
  );
}
