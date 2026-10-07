import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUseField, canUsePreProduction } from "@/server/authz/policy";
import { getEvent } from "@/modules/events/events.service";
import { getFunction } from "@/modules/functions/functions.service";
import { TopBar } from "@/components/top-bar";
import { EventTabs } from "@/components/event-nav";
import { ActivityForm, ActivityList } from "@/components/plan";
import { Card, PAGE, SectionTitle, cx } from "@/components/ui";
import { FunctionEditor, PeoplePicker } from "../forms";

export const metadata = { title: "Função" };

/** Uma função: o que faz, as atividades (dia e horário) e quem tem. */
export default async function FunctionPage({ params }: PageProps<"/eventos/[eventId]/pre-producao/funcoes/[functionId]">) {
  const actor = await requireUser();
  const { eventId, functionId } = await params;
  if (!canUsePreProduction(actor, eventId)) notFound();
  const [event, fn] = await Promise.all([getEvent(actor, eventId), getFunction(actor, functionId)]);
  if (fn.eventId !== eventId) notFound();
  const back = `/eventos/${eventId}/pre-producao/funcoes`;
  const count = fn.people.filter((p) => p.function?.id === fn.id).length;
  const firstDay = event.startsAt.toISOString().slice(0, 10);

  return (
    <>
      <TopBar title={fn.name} subtitle={event.name} back={back} />
      {canUseField(actor, eventId) && <EventTabs eventId={eventId} active="pre" />}
      <main className={cx(PAGE, "py-4 lg:py-6")}>
        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          <div>
            <SectionTitle>Função</SectionTitle>
            <Card><FunctionEditor fn={fn} back={back} /></Card>
          </div>
          <div>
            <SectionTitle>Atividades ({fn.activities.length})</SectionTitle>
            <Card className="space-y-5">
              <p className="text-sm text-muted">Valem para todos que têm esta função. Cada pessoa marca o que já fez.</p>
              <ActivityList activities={fn.activities} editable="all" emptyText="Nenhuma atividade ainda." />
              <div className="border-t border-border pt-4">
                <ActivityForm endpoint={`/api/functions/${fn.id}/activities`} defaultDay={firstDay} />
              </div>
            </Card>
          </div>
        </div>

        <SectionTitle>Quem tem esta função ({count})</SectionTitle>
        <PeoplePicker functionId={fn.id} people={fn.people} />
      </main>
    </>
  );
}
