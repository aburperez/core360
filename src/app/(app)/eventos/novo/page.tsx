import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { isAgencyAdmin } from "@/server/authz/actor";
import { listClients, resolveAgency } from "@/modules/clients/clients.service";
import { TopBar } from "@/components/top-bar";
import { Card, EmptyState } from "@/components/ui";
import { EventForm } from "@/components/event-form";

export const metadata = { title: "Novo evento" };

/** Criar evento: só o Admin da agência, para um cliente da agência. */
export default async function NewEventPage({ searchParams }: PageProps<"/eventos/novo">) {
  const actor = await requireUser("/eventos/novo");
  if (!isAgencyAdmin(actor)) notFound();
  const { agencia } = await searchParams;
  const agency = (() => {
    try {
      return resolveAgency(actor, typeof agencia === "string" ? agencia : actor.adminAgencies[0].id);
    } catch {
      return null;
    }
  })();
  if (!agency) notFound();
  const clients = (await listClients(actor, agency.id)).filter((c) => c.status === "ACTIVE");
  const q = actor.adminAgencies.length > 1 ? `?agencia=${agency.id}` : "";

  return (
    <>
      <TopBar title="Novo evento" subtitle={agency.name} back="/eventos?todos=1" narrow />
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-4 lg:py-6">
        {clients.length === 0 ? (
          <EmptyState title="Cadastre um cliente primeiro">
            Todo evento é de um cliente. <Link href={`/clientes${q}`} className="font-semibold text-primary">Cadastrar cliente</Link>
          </EmptyState>
        ) : (
          <>
            <p className="text-sm text-muted">
              Os diretores de produção da agência entram como Gerente assim que o evento é criado. Depois, monte as áreas e as equipes.
            </p>
            <Card>
              <EventForm mode="create" clients={clients.map((c) => ({ id: c.id, name: c.name }))} />
            </Card>
            <p className="px-1 text-sm text-muted">
              O cliente não está na lista? <Link href={`/clientes${q}`} className="font-semibold text-primary">Cadastrar cliente</Link>
            </p>
          </>
        )}
      </main>
    </>
  );
}
