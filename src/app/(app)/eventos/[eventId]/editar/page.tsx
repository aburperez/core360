import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { isEventAdmin, membershipFor } from "@/server/authz/actor";
import { eventLeaders, getEvent, getEventFinances } from "@/modules/events/events.service";
import { TopBar } from "@/components/top-bar";
import { PageHeading } from "@/components/panel";
import { EventStages } from "@/components/event-stages";
import { PAGE, cx } from "@/components/ui";
import { EventRecordForm } from "@/components/event-record-form";
import { toLocalInput } from "@/lib/tz";
import { decimal } from "@/lib/money";

export const metadata = { title: "Ficha do evento" };

/** Ficha completa e etapa do evento: Admin da agência ou Gerente. */
export default async function EditEventPage({ params }: PageProps<"/eventos/[eventId]/editar">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!isEventAdmin(actor, eventId) && membershipFor(actor, eventId)?.role !== "GERENTE") notFound();
  const [e, leaders, finances] = await Promise.all([getEvent(actor, eventId), eventLeaders(actor, eventId), getEventFinances(actor, eventId)]);
  const at = (d: Date | null) => (d ? toLocalInput(d, e.timezone) : "");

  return (
    <>
      <TopBar title="Ficha do evento" subtitle={e.name} back={`/eventos/${eventId}`} />
      <main className={cx(PAGE, "space-y-4 py-4 lg:max-w-4xl lg:py-6")}>
        <PageHeading trail={[e.name]} title="Ficha do evento" />
        <p className="px-1 text-sm text-muted">Cliente: {e.client.name}. Datas e horas no fuso do evento ({e.timezone.replace("_", " ")}).</p>
        <EventStages status={e.status} />
        <EventRecordForm
          eventId={eventId}
          leaders={leaders}
          finances={finances && { approvedBudget: finances.approvedBudget === null ? "" : decimal(finances.approvedBudget), costCenter: finances.costCenter }}
          initial={{
            name: e.name, project: e.project, eventType: e.eventType, description: e.description, status: e.status,
            startsAt: at(e.startsAt), endsAt: at(e.endsAt), setupStartsAt: at(e.setupStartsAt), setupEndsAt: at(e.setupEndsAt),
            teardownStartsAt: at(e.teardownStartsAt), teardownEndsAt: at(e.teardownEndsAt),
            venue: e.venue, address: e.address, city: e.city, state: e.state, expectedAudience: e.expectedAudience,
            leadId: e.leadId, producerId: e.producerId, notes: e.notes,
          }}
        />
      </main>
    </>
  );
}
