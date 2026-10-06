import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUsePreProduction } from "@/server/authz/policy";
import { getTeam } from "@/modules/teams/teams.service";
import { listBriefings } from "@/modules/briefings/briefings.service";
import { TopBar } from "@/components/top-bar";
import { BriefingPill } from "@/components/briefing-view";
import { Card, EmptyState, PAGE, SectionTitle, cx } from "@/components/ui";
import { BriefingForm } from "../../briefing-form";

export const metadata = { title: "Briefing da equipe" };

/** Escrever uma vez e aplicar a todos da equipe. */
export default async function TeamBriefingPage({ params }: PageProps<"/eventos/[eventId]/pre-producao/briefing/equipe/[teamId]">) {
  const actor = await requireUser();
  const { eventId, teamId } = await params;
  if (!canUsePreProduction(actor, eventId)) notFound();
  const team = await getTeam(actor, teamId);
  if (team.eventId !== eventId) notFound();
  const people = (await listBriefings(actor, eventId)).filter((p) => p.teamId === team.id);
  const back = `/eventos/${eventId}/pre-producao/briefing`;

  return (
    <>
      <TopBar title={`Equipe ${team.name}`} subtitle="Briefing para a equipe toda" back={back} />
      <main className={cx(PAGE, "py-4 lg:py-6")}>
        {people.length === 0 ? (
          <EmptyState title="Ninguém nesta equipe ainda" />
        ) : (
          <div className="lg:grid lg:grid-cols-5 lg:items-start lg:gap-6">
            <Card className="lg:col-span-3">
              <p className="mb-4 text-sm text-muted">
                O mesmo texto vai para todos da equipe. Depois dá para ajustar o de cada pessoa.
              </p>
              <BriefingForm action={{ kind: "team", teamId: team.id, people: people.length, withBriefing: people.filter((p) => p.state !== "SEM").length, back }} />
            </Card>
            <div className="lg:col-span-2">
              <SectionTitle>Quem recebe ({people.length})</SectionTitle>
              <Card className="p-0">
                <ul className="divide-y divide-border">
                  {people.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <span className="min-w-0">
                        <span className="block font-medium">{p.name}</span>
                        {p.jobTitle && <span className="block text-sm text-muted">{p.jobTitle}</span>}
                      </span>
                      <BriefingPill state={p.state} />
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
