import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUseSection, isExecutive } from "@/server/authz/policy";
import { getEvent } from "@/modules/events/events.service";
import { planReaderOptions } from "@/modules/items/plan-reading.service";
import { TopBar } from "@/components/top-bar";
import { PageHeading } from "@/components/panel";
import { PAGE, cx } from "@/components/ui";
import { PlanReader } from "./reader";

export const metadata = { title: "Ler planta técnica" };

/**
 * Leitor de planta da área Técnica: sobe a planta (PDF ou foto), a IA lista
 * os itens técnicos e a pessoa confere antes de eles entrarem na planilha.
 */
export default async function TechnicalPlanPage({ params }: PageProps<"/eventos/[eventId]/pre-producao/itens/ler-planta">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!canUseSection(actor, eventId, "ITENS") || isExecutive(actor, eventId)) notFound();
  const [event, options] = await Promise.all([getEvent(actor, eventId), planReaderOptions(actor, eventId)]);
  return (
    <>
      <TopBar title="Ler planta técnica" subtitle={event.name} back={`/eventos/${eventId}/pre-producao/itens`} />
      <main className={cx(PAGE, "space-y-4 py-4 lg:py-6")}>
        <PageHeading trail={[event.name, "Pré-produção", "Mapa de itens"]} title="Ler planta técnica" />
        <p className="text-sm text-muted">
          Envie a planta técnica (som, luz, LED, vídeo, energia, estrutura) em PDF ou foto. A IA lista os itens com quantidade e local,
          e você confere tudo antes de eles entrarem na planilha. Nada é salvo só com a leitura.
        </p>
        <PlanReader eventId={eventId} options={options} />
      </main>
    </>
  );
}
