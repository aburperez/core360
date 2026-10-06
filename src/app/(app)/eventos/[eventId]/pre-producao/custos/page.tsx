import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUseField, canUsePreProduction } from "@/server/authz/policy";
import { getEvent } from "@/modules/events/events.service";
import { getCostSheet } from "@/modules/costs/costs.service";
import { listReceiverOptions } from "@/modules/receipts/receipts.service";
import { TopBar } from "@/components/top-bar";
import { EventTabs } from "@/components/event-nav";
import { PAGE, cx } from "@/components/ui";
import { CostsEditor } from "./costs-editor";

export const metadata = { title: "Custos" };

/** Planilha de custos do evento, no formato da matriz de orçamento. */
export default async function CostsPage({ params }: PageProps<"/eventos/[eventId]/pre-producao/custos">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!canUsePreProduction(actor, eventId)) notFound();
  const [event, sheet, receivers] = await Promise.all([getEvent(actor, eventId), getCostSheet(actor, eventId), listReceiverOptions(actor, eventId)]);

  return (
    <>
      <TopBar title="Custos" subtitle={event.name} />
      {canUseField(actor, eventId) && <EventTabs eventId={eventId} active="pre" />}
      <main className={cx(PAGE, "py-4 lg:py-6")}>
        <CostsEditor eventId={eventId} sheet={sheet} receivers={receivers} />
      </main>
    </>
  );
}
