import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { isEventAdmin, membershipFor } from "@/server/authz/actor";
import { getEvent } from "@/modules/events/events.service";
import { TopBar } from "@/components/top-bar";
import { Card, PAGE, cx } from "@/components/ui";
import { EventForm } from "@/components/event-form";
import { toLocalInput } from "@/lib/tz";

export const metadata = { title: "Dados do evento" };

/** Nome, datas, local e fase do evento: Admin da agência ou Gerente. */
export default async function EditEventPage({ params }: PageProps<"/eventos/[eventId]/editar">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!isEventAdmin(actor, eventId) && membershipFor(actor, eventId)?.role !== "GERENTE") notFound();
  const e = await getEvent(actor, eventId);

  return (
    <>
      <TopBar title="Dados do evento" subtitle={e.name} back={`/eventos/${eventId}`} />
      <main className={cx(PAGE, "py-4 lg:max-w-2xl lg:py-6")}>
        <p className="mb-3 px-1 text-sm text-muted">Cliente: {e.client.name}. Datas e horas no fuso do evento ({e.timezone.replace("_", " ")}).</p>
        <Card>
          <EventForm
            mode="edit"
            eventId={eventId}
            initial={{
              name: e.name, description: e.description, venue: e.venue, address: e.address, status: e.status,
              startsAt: toLocalInput(e.startsAt, e.timezone), endsAt: toLocalInput(e.endsAt, e.timezone),
            }}
          />
        </Card>
      </main>
    </>
  );
}
