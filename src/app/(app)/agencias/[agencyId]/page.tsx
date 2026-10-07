import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { isAgencyAdmin } from "@/server/authz/actor";
import { getAgency } from "@/modules/agencies/agencies.service";
import { TopBar } from "@/components/top-bar";
import { SectionTitle } from "@/components/ui";
import { AgencyAdmins, AgencySettings } from "../forms";

export const metadata = { title: "Agência" };

/** A agência e os Admins dela: para a plataforma e para os próprios Admins. */
export default async function AgencyPage({ params }: PageProps<"/agencias/[agencyId]">) {
  const { agencyId } = await params;
  const actor = await requireUser(`/agencias/${agencyId}`);
  if (!actor.isPlatformAdmin && !isAgencyAdmin(actor, agencyId)) notFound();
  const agency = await getAgency(actor, agencyId).catch(() => null);
  if (!agency) notFound();

  return (
    <>
      <TopBar
        title={agency.name}
        subtitle={agency.status === "ACTIVE" ? "Agência ativa" : "Agência suspensa"}
        back={actor.isPlatformAdmin ? "/agencias" : "/eventos?todos=1"}
        narrow
      />
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-4 lg:py-6">
        {actor.isPlatformAdmin && <AgencySettings agency={agency} />}
        <SectionTitle>Admins da agência</SectionTitle>
        <p className="text-sm text-muted">
          Os Admins criam clientes e eventos, cadastram os diretores e entram em todos os eventos da agência.
        </p>
        <AgencyAdmins agencyId={agency.id} admins={agency.admins} me={actor.email} />
      </main>
    </>
  );
}
