import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUsePreProduction } from "@/server/authz/policy";
import { listArrivals } from "@/modules/arrivals/arrivals.service";
import { TopBar } from "@/components/top-bar";
import { PageHeading } from "@/components/panel";
import { PAGE, cx } from "@/components/ui";
import { ArrivalsBoard } from "../../montagem/board";
import { ArrivalDialog } from "../../montagem/actions";

export const metadata = { title: "Mapa de montagem" };

/**
 * Pré-produção: o mapa de montagem. Cada contrato assinado vira uma chegada;
 * aqui se completa horário, veículo, doca, área e responsável. O campo vê e
 * marca o status pela tela Montagem.
 */
export default async function ArrivalsMapPage({ params }: PageProps<"/eventos/[eventId]/pre-producao/montagem">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!canUsePreProduction(actor, eventId)) notFound();
  const data = await listArrivals(actor, eventId);
  const add = <ArrivalDialog eventId={eventId} areas={data.areas} people={data.people} costItems={data.costItems} />;
  return (
    <>
      <TopBar title="Mapa de montagem" subtitle={data.eventName} back={`/eventos/${eventId}/pre-producao`} />
      <main className={cx(PAGE, "space-y-4 py-4 lg:py-6")}>
        <PageHeading trail={[data.eventName, "Pré-produção"]} title="Mapa de montagem">{add}</PageHeading>
        <p className="text-sm text-muted">
          Cada contrato assinado vira uma chegada, com os itens dele. Complete o horário, o veículo, a doca, a área e o responsável. O Gerente, o
          Head da área e o responsável veem no celular e marcam quando chegou e quando montou. Valores não aparecem.
        </p>
        <div className="lg:hidden">{add}</div>
        <ArrivalsBoard data={data} eventId={eventId} />
      </main>
    </>
  );
}
