import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { isAgencyAdmin, isAgencyFullAdmin } from "@/server/authz/actor";
import { listDirectors } from "@/modules/directors/directors.service";
import { resolveAgency } from "@/modules/clients/clients.service";
import { TopBar } from "@/components/top-bar";
import { DirectorsAdmin } from "./directors-admin";

export const metadata = { title: "Diretores de produção" };

/**
 * Painel dos diretores de produção da agência. O Suporte só vê; para quem não
 * é da agência a página não existe.
 */
export default async function DirectorsPage({ searchParams }: PageProps<"/diretores">) {
  const actor = await requireUser("/diretores");
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
  const directors = await listDirectors(actor, agency.id);
  return (
    <>
      <TopBar title="Diretores de produção" subtitle={agency.name} back="/eventos?todos=1" narrow />
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-4 lg:py-6">
        <p className="text-sm text-muted">
          O diretor de produção é quem administra a agência no CORE 360: cria clientes e eventos, cadastra outros diretores
          e entra como Gerente em todos os eventos abertos e nos que forem criados depois. Cada um tem o próprio login, e um
          convite só vale para tudo. Para tirar um diretor de um evento específico, desative-o em Montar equipe daquele evento.
        </p>
        <DirectorsAdmin agencyId={agency.id} canManage={isAgencyFullAdmin(actor, agency.id)} directors={directors.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() }))} />
      </main>
    </>
  );
}
