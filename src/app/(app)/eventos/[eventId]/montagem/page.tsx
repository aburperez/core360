import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUseField } from "@/server/authz/policy";
import { membershipFor } from "@/server/authz/actor";
import { canSeeArrivals, listArrivals } from "@/modules/arrivals/arrivals.service";
import { TopBar } from "@/components/top-bar";
import { PageHeading } from "@/components/panel";
import { PAGE, cx } from "@/components/ui";
import { ArrivalsBoard } from "./board";

export const metadata = { title: "Montagem" };

/**
 * Campo: as chegadas dos fornecedores na montagem, por dia e hora. O Gerente
 * vê todas; o Head, as da área dele; o Operacional, as que são dele. Marca
 * chegou, montando, montado e retirado. Sem valores.
 */
export default async function FieldArrivalsPage({ params }: PageProps<"/eventos/[eventId]/montagem">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!canUseField(actor, eventId) || !canSeeArrivals(actor, eventId)) notFound();
  const data = await listArrivals(actor, eventId);
  const head = membershipFor(actor, eventId)?.role === "HEAD";
  return (
    <>
      <TopBar title="Montagem" subtitle={data.eventName} />
      <main className={cx(PAGE, "space-y-4 py-4 lg:py-6")}>
        <PageHeading trail={[data.eventName, "Gestão de campo"]} title="Chegadas da montagem" />
        <p className="text-sm text-muted">
          {head ? "As chegadas dos fornecedores da sua área" : "As chegadas dos fornecedores"}, por dia e hora. Toque em <b>Chegou</b> quando o fornecedor
          chegar e acompanhe até montado. Quem passou do horário fica em vermelho.
        </p>
        <ArrivalsBoard data={data} eventId={eventId} />
      </main>
    </>
  );
}
