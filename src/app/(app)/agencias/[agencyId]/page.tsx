import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { isAgencyAdmin, isAgencyFullAdmin } from "@/server/authz/actor";
import { getAgency } from "@/modules/agencies/agencies.service";
import { TopBar } from "@/components/top-bar";
import { SectionTitle } from "@/components/ui";
import { AgencyAdmins, AgencySettings } from "../forms";

export const metadata = { title: "Agência" };

/**
 * A agência, os diretores de produção e o Suporte dela: para a plataforma e
 * para a própria agência. A agência cuida dos diretores em /diretores.
 */
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
        <SectionTitle>Diretores de produção</SectionTitle>
        <p className="text-sm text-muted">
          Cada diretor de produção tem o próprio login, cria clientes e eventos e entra como Gerente em todos os eventos da
          agência.
        </p>
        {actor.isPlatformAdmin ? (
          <AgencyAdmins agencyId={agency.id} admins={admins} me={actor.email} canManage />
        ) : (
          <Link href="/diretores" className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4">
            <span className="min-w-0">
              <span className="block font-semibold">
                {admins.filter((a) => a.active).length} {admins.filter((a) => a.active).length === 1 ? "diretor ativo" : "diretores ativos"}
              </span>
              <span className="block text-sm text-muted">{fullAdmin ? "Cadastrar, convidar e desativar" : "Ver quem são"}</span>
            </span>
            <span className="text-2xl text-primary">›</span>
          </Link>
        )}

        <SectionTitle>Suporte CORE 360</SectionTitle>
        <p className="text-sm text-muted">
          Quem a agência autoriza da equipe CORE 360 para entrar e ajudar quando algo dá errado. O Suporte vê e mexe em
          tudo o que o diretor mexe, menos diretores e Suporte. Tudo o que ele faz fica registrado, e o acesso pode ser
          desligado a qualquer momento.
        </p>
        {!supportOn && (
          <p className="rounded-2xl border border-amber-400/40 bg-amber-500/10 p-3 text-sm text-amber-100">
            {fullAdmin
              ? "Nenhum Suporte autorizado. Cadastre o e-mail que a CORE 360 passou para que a gente consiga ajudar."
              : "Esta agência ainda não autorizou o Suporte. Só um diretor de produção dela pode autorizar."}
          </p>
        )}
        <AgencyAdmins agencyId={agency.id} admins={support} me={actor.email} role="SUPORTE" canManage={fullAdmin} />
      </main>
    </>
  );
}
