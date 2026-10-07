import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { isAgencyAdmin } from "@/server/authz/actor";
import { listClients, resolveAgency } from "@/modules/clients/clients.service";
import { TopBar } from "@/components/top-bar";
import { ClientsAdmin } from "./clients-admin";

export const metadata = { title: "Clientes" };

/** Clientes da agência: só os Admins dela. */
export default async function ClientsPage({ searchParams }: PageProps<"/clientes">) {
  const actor = await requireUser("/clientes");
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
  const clients = await listClients(actor, agency.id);

  return (
    <>
      <TopBar title="Clientes" subtitle={agency.name} back="/eventos?todos=1" narrow />
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-4 lg:py-6">
        <p className="text-sm text-muted">Quem contrata os eventos. Todo evento é de um cliente.</p>
        <ClientsAdmin clients={clients} agencyId={agency.id} />
      </main>
    </>
  );
}
