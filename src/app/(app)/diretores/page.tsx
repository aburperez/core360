import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { isAgencyAdmin } from "@/server/authz/actor";
import { listDirectors } from "@/modules/directors/directors.service";
import { resolveAgency } from "@/modules/clients/clients.service";
import { TopBar } from "@/components/top-bar";
import { DirectorsAdmin } from "./directors-admin";

export const metadata = { title: "Diretores de produção" };

/** Só o Admin da agência. Para os outros a página não existe. */
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
      <TopBar title="Diretores de produção" subtitle={`${agency.name} · Gerente em todos os eventos`} back="/eventos?todos=1" narrow />
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-4 lg:py-6">
        <p className="text-sm text-muted">
          Quem você cadastrar aqui entra como Gerente em todos os eventos abertos da agência e nos que forem criados depois.
          Um convite só vale para todos. Para tirar o diretor de um evento específico, desative-o em Montar equipe daquele evento.
        </p>
        <DirectorsAdmin agencyId={agency.id} directors={directors.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() }))} />
      </main>
    </>
  );
}
