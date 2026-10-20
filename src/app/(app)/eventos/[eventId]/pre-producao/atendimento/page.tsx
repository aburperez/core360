import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUseSection } from "@/server/authz/policy";
import { getEvent } from "@/modules/events/events.service";
import { listParticipants } from "@/modules/participants/participants.service";
import { listClientViews } from "@/modules/participants/client-views.service";
import { TopBar } from "@/components/top-bar";
import { PageHeading } from "@/components/panel";
import { EmptyState, PAGE, cx } from "@/components/ui";
import { ClientCards } from "./clients";

export const metadata = { title: "Atendimento" };

/**
 * Atendimento (hierarquia de acessos, 2026-10-20): quem cuida do cliente
 * decide o que cada Cliente do evento acompanha (andamento, equipe, custos).
 * O Produtor executivo tem esta parte fixa; o Pré-produtor, se marcarem a caixa.
 */
export default async function ServicePage({ params }: PageProps<"/eventos/[eventId]/pre-producao/atendimento">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!canUseSection(actor, eventId, "ATENDIMENTO")) notFound();
  const [event, people, views] = await Promise.all([
    getEvent(actor, eventId),
    listParticipants(actor, eventId),
    listClientViews(actor, eventId),
  ]);
  const clients = people.filter((p) => p.role === "CLIENTE" && p.active);

  return (
    <>
      <TopBar title="Atendimento" subtitle={event.name} back={`/eventos/${eventId}/pre-producao`} />
      <main className={cx(PAGE, "py-4 lg:py-6")}>
        <PageHeading trail={[event.name, "Pré-produção"]} title="Atendimento" />
        <div className="max-w-3xl space-y-4">
          <p className="text-sm text-muted">
            O que cada cliente acompanha do evento. Ele só olha, não muda nada.
            {canUseSection(actor, eventId, "DOCUMENTOS") && (
              <> Os arquivos do cliente ficam em <Link href={`/eventos/${eventId}/pre-producao/documentos`} className="text-primary underline">Documentos</Link>.</>
            )}
          </p>
          {clients.length === 0 ? (
            <EmptyState title="Nenhum cliente no evento">O Gerente de produção cadastra o cliente em Montar equipe.</EmptyState>
          ) : (
            <ClientCards
              clients={clients.map((c) => ({ id: c.id, name: c.name, email: c.email, company: c.company, joined: !!c.userId }))}
              views={views}
            />
          )}
        </div>
      </main>
    </>
  );
}
