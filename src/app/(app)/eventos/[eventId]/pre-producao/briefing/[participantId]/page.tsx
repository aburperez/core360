import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUsePreProduction } from "@/server/authz/policy";
import { getBriefingFor } from "@/modules/briefings/briefings.service";
import { TopBar } from "@/components/top-bar";
import { BriefingAutoView, BriefingPill } from "@/components/briefing-view";
import { Card, PAGE, SectionTitle, cx } from "@/components/ui";
import { ROLE_LABEL, formatDateTime } from "@/lib/format";
import { BriefingForm } from "../briefing-form";

export const metadata = { title: "Briefing" };

/** Escrever o briefing de uma pessoa, vendo o que entra sozinho. */
export default async function BriefingEditPage({ params }: PageProps<"/eventos/[eventId]/pre-producao/briefing/[participantId]">) {
  const actor = await requireUser();
  const { eventId, participantId } = await params;
  if (!canUsePreProduction(actor, eventId)) notFound();
  const { person, briefing, state, auto } = await getBriefingFor(actor, eventId, participantId);
  const where = person.team ? `${person.area?.name} › ${person.team.name}` : (person.area?.name ?? "Gestão do evento");

  return (
    <>
      <TopBar title={person.name} subtitle={`Briefing · ${person.jobTitle ?? ROLE_LABEL[person.role]}`} back={`/eventos/${eventId}/pre-producao/funcoes`} />
      <main className={cx(PAGE, "py-4 lg:py-6")}>
        <div className="lg:grid lg:grid-cols-5 lg:items-start lg:gap-6">
          <div className="lg:col-span-3">
            <Card>
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0 text-sm text-muted">
                  <p>{ROLE_LABEL[person.role]} · {where}</p>
                  {briefing && (
                    <p className="mt-0.5">
                      Atualizado em {formatDateTime(briefing.updatedAt)}{briefing.updatedBy ? ` por ${briefing.updatedBy}` : ""}
                      {state === "LIDO" && briefing.readAt ? ` · leu em ${formatDateTime(briefing.readAt)}` : ""}
                    </p>
                  )}
                </div>
                <BriefingPill state={state} />
              </div>
              <BriefingForm
                key={briefing?.version ?? 0}
                action={{ kind: "person", eventId, participantId: person.id, briefingId: briefing?.id ?? null, wasRead: state === "LIDO" }}
                initial={briefing}
                jobTitle={person.jobTitle}
              />
            </Card>
          </div>
          <div className="lg:col-span-2">
            <SectionTitle>Entra sozinho</SectionTitle>
            <BriefingAutoView auto={auto} editing />
          </div>
        </div>
      </main>
    </>
  );
}
