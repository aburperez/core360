import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUseField, canUsePreProduction } from "@/server/authz/policy";
import { getEvent } from "@/modules/events/events.service";
import { getMyBriefing } from "@/modules/briefings/briefings.service";
import { getMyPlan } from "@/modules/functions/functions.service";
import { TopBar } from "@/components/top-bar";
import { EventTabs } from "@/components/event-nav";
import { BriefingView } from "@/components/briefing-view";
import { MyAgenda, ProfileForm } from "@/components/plan";
import { Card, EmptyState, PAGE, SectionTitle, cx } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { ReadButton } from "./read-button";

export const metadata = { title: "Meu briefing" };

/**
 * O briefing da pessoa logada: só o dela. Função e agenda vêm do painel de
 * funções; o texto, da Pré-produção. A ficha a própria pessoa preenche.
 */
export default async function MyBriefingPage({ params }: PageProps<"/eventos/[eventId]/briefing">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!canUseField(actor, eventId)) notFound();
  const [event, mine, plan] = await Promise.all([getEvent(actor, eventId), getMyBriefing(actor, eventId), getMyPlan(actor, eventId)]);
  const hasPlan = !!plan && (!!plan.function || plan.activities.length > 0);

  return (
    <>
      <TopBar title="Meu briefing" subtitle={event.name} />
      {canUsePreProduction(actor, eventId) && <EventTabs eventId={eventId} active="campo" />}
      <main className={cx(PAGE, "space-y-4 py-4 lg:max-w-3xl lg:py-6")}>
        {!mine && !hasPlan && (
          <EmptyState title="Seu briefing ainda não foi escrito">
            Quando a pré-produção escrever o que você faz, onde e quando, ele aparece aqui.
          </EmptyState>
        )}

        {plan?.function && (
          <Card className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Minha função</p>
            <p className="text-lg font-semibold">{plan.function.name}</p>
            {plan.function.description && <p className="whitespace-pre-line text-sm text-muted">{plan.function.description}</p>}
          </Card>
        )}
        {plan && plan.activities.length > 0 && <MyAgenda eventId={eventId} activities={plan.activities} />}

        {mine && (
          <div>
            {mine.state === "MUDOU" && (
              <p className="mb-3 rounded-2xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-200">
                O briefing mudou depois da sua última leitura. Leia de novo e confirme.
              </p>
            )}
            <BriefingView text={mine.briefing} jobTitle={mine.person.jobTitle} team={mine.person.team?.name ?? mine.person.area?.name} auto={mine.auto} />
            <div className="mt-4">
              {mine.state === "LIDO" ? (
                <p className="px-1 text-sm text-emerald-300">✓ Você confirmou a leitura em {formatDateTime(mine.briefing.readAt)}.</p>
              ) : (
                <ReadButton eventId={eventId} />
              )}
            </div>
          </div>
        )}

        {plan && (
          <section>
            <SectionTitle>Minha ficha</SectionTitle>
            <Card>
              <ProfileForm
                endpoint={`/api/events/${eventId}/my-plan/profile`}
                initial={plan.profile}
                intro="Para a produção: credencial, uniforme, alimentação e quem avisar numa emergência. Só a pré-produção vê."
              />
            </Card>
          </section>
        )}
      </main>
    </>
  );
}
