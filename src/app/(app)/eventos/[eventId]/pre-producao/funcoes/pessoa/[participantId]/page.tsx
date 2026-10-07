import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUseField, canUsePreProduction } from "@/server/authz/policy";
import { getEvent } from "@/modules/events/events.service";
import { getPersonPlan } from "@/modules/functions/functions.service";
import { TopBar } from "@/components/top-bar";
import { EventTabs } from "@/components/event-nav";
import { ActivityForm, ActivityList, ProfileForm } from "@/components/plan";
import { Card, LinkButton, PAGE, SectionTitle, cx } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/format";
import { FunctionSelect } from "../../forms";

export const metadata = { title: "Pessoa" };

/** Pré-produção: uma pessoa, com função, agenda e ficha. */
export default async function PersonPlanPage({ params }: PageProps<"/eventos/[eventId]/pre-producao/funcoes/pessoa/[participantId]">) {
  const actor = await requireUser();
  const { eventId, participantId } = await params;
  if (!canUsePreProduction(actor, eventId)) notFound();
  const [event, plan] = await Promise.all([getEvent(actor, eventId), getPersonPlan(actor, eventId, participantId)]);
  const { person, profile } = plan;
  const base = `/eventos/${eventId}/pre-producao`;
  const done = plan.activities.filter((a) => a.doneAt).length;
  const firstDay = event.startsAt.toISOString().slice(0, 10);

  return (
    <>
      <TopBar title={person.name} subtitle={event.name} back={`${base}/funcoes`} />
      {canUseField(actor, eventId) && <EventTabs eventId={eventId} active="pre" />}
      <main className={cx(PAGE, "py-4 lg:py-6")}>
        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          <div className="space-y-4">
            <div>
              <SectionTitle>Dados</SectionTitle>
              <Card className="space-y-1 text-sm">
                <p><span className="text-muted">Papel:</span> {ROLE_LABEL[person.role]}{person.jobTitle ? ` · ${person.jobTitle}` : ""}</p>
                <p><span className="text-muted">Equipe:</span> {[person.area?.name, person.team?.name].filter(Boolean).join(" › ") || "Gestão do evento"}</p>
                <p><span className="text-muted">E-mail:</span> {person.email}</p>
                <p>
                  <span className="text-muted">Telefone:</span>{" "}
                  {person.phone ? <a className="text-primary" href={`tel:${person.phone.replace(/[^\d+]/g, "")}`}>{person.phone}</a> : "—"}
                </p>
                <p className="pt-1 text-xs text-muted">Nome, e-mail e telefone mudam em Montar equipe.</p>
              </Card>
            </div>
            <div>
              <SectionTitle>Função</SectionTitle>
              <Card className="space-y-2">
                <FunctionSelect eventId={eventId} participantId={person.id} value={profile?.functionId ?? null} functions={plan.functions} />
                {profile?.function && (
                  <>
                    {profile.function.description && <p className="whitespace-pre-line text-sm text-muted">{profile.function.description}</p>}
                    <Link href={`${base}/funcoes/${profile.function.id}`} className="inline-block text-sm font-semibold text-primary">
                      Abrir a função ›
                    </Link>
                  </>
                )}
              </Card>
            </div>
            <div>
              <SectionTitle>Ficha</SectionTitle>
              <Card>
                <ProfileForm
                  endpoint={`/api/events/${eventId}/people/${person.id}/profile`}
                  initial={profile}
                  intro="A própria pessoa também preenche em “Meu briefing”. Só a Pré-produção e ela veem."
                />
              </Card>
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <SectionTitle>Agenda ({done}/{plan.activities.length} feitas)</SectionTitle>
              <Card className="space-y-5">
                <ActivityList
                  activities={plan.activities}
                  editable="own"
                  emptyText="Nenhuma atividade. Dê uma função com atividades ou adicione uma só para esta pessoa."
                />
                <div className="border-t border-border pt-4">
                  <p className="mb-3 text-sm font-semibold">Atividade só desta pessoa</p>
                  <ActivityForm endpoint={`/api/events/${eventId}/people/${person.id}/activities`} defaultDay={firstDay} />
                </div>
              </Card>
            </div>
            <LinkButton href={`${base}/briefing/${person.id}`} variant="secondary" className="w-full">Escrever o briefing ›</LinkButton>
          </div>
        </div>
      </main>
    </>
  );
}
