import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUseField, canUsePreProduction } from "@/server/authz/policy";
import { getEvent } from "@/modules/events/events.service";
import { getPlanBoard } from "@/modules/floorplans/floorplans.service";
import { TopBar } from "@/components/top-bar";
import { EventTabs } from "@/components/event-nav";
import { PageHeading } from "@/components/panel";
import { PAGE, cx } from "@/components/ui";
import { PlanBoard } from "./board";

export const metadata = { title: "Planta do evento" };

/**
 * A planta do evento dentro do app, com as etapas de montagem e de
 * finalização marcadas no lugar onde acontecem. Todos do campo veem; o
 * gerente envia a planta e marca etapas; o head marca as da área dele.
 */
export default async function PlantaPage({ params, searchParams }: PageProps<"/eventos/[eventId]/planta">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!canUseField(actor, eventId)) notFound();
  const p = (await searchParams).p;
  const [event, board] = await Promise.all([getEvent(actor, eventId), getPlanBoard(actor, eventId, typeof p === "string" ? p : null)]);

  return (
    <>
      <TopBar title="Planta do evento" subtitle={event.name} />
      {canUsePreProduction(actor, eventId) && <EventTabs eventId={eventId} active="campo" />}
      <main className={cx(PAGE, "py-4 lg:py-6")}>
        <PageHeading trail={[event.name, "Gestão de campo"]} title="Planta do evento" />
        <PlanBoard key={board.plan?.id ?? "none"} board={board} eventId={eventId} />
      </main>
    </>
  );
}
