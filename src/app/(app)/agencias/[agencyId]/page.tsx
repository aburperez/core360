import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { isAgencyAdmin, isAgencyFullAdmin } from "@/server/authz/actor";
import { getAgency } from "@/modules/agencies/agencies.service";
import { TopBar } from "@/components/top-bar";
import { SectionTitle } from "@/components/ui";
import { AgencyAdmins, AgencySettings } from "../forms";

export const metadata = { title: "Agência" };

/** A agência, os Admins e o Suporte dela: para a plataforma e para a própria agência. */
export default async function AgencyPage({ params }: PageProps<"/agencias/[agencyId]">) {
  const { agencyId } = await params;
  const actor = await requireUser(`/agencias/${agencyId}`);
  if (!actor.isPlatformAdmin && !isAgencyAdmin(actor, agencyId)) notFound();
  const agency = await getAgency(actor, agencyId).catch(() => null);
  if (!agency) notFound();
  const fullAdmin = isAgencyFullAdmin(actor, agency.id);
  const admins = agency.admins.filter((a) => a.role === "ADMIN");
  const support = agency.admins.filter((a) => a.role === "SUPORTE");
  const supportOn = support.some((a) => a.active);

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
        <AgencyAdmins agencyId={agency.id} admins={admins} me={actor.email} canManage={fullAdmin || actor.isPlatformAdmin} />

        <SectionTitle>Suporte CORE 360</SectionTitle>
        <p className="text-sm text-muted">
          Quem a agência autoriza da equipe CORE 360 para entrar e ajudar quando algo dá errado. O Suporte vê e mexe em
          tudo o que o Admin mexe, menos Admins e Suporte. Tudo o que ele faz fica registrado, e o acesso pode ser
          desligado a qualquer momento.
        </p>
        {!supportOn && (
          <p className="rounded-2xl border border-amber-400/40 bg-amber-500/10 p-3 text-sm text-amber-100">
            {fullAdmin
              ? "Nenhum Suporte autorizado. Cadastre o e-mail que a CORE 360 passou para que a gente consiga ajudar."
              : "Esta agência ainda não autorizou o Suporte. Só um Admin dela pode autorizar."}
          </p>
        )}
        <AgencyAdmins agencyId={agency.id} admins={support} me={actor.email} role="SUPORTE" canManage={fullAdmin} />
      </main>
    </>
  );
}
