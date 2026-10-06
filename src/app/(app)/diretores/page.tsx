import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { listDirectors } from "@/modules/directors/directors.service";
import { TopBar } from "@/components/top-bar";
import { DirectorsAdmin } from "./directors-admin";

export const metadata = { title: "Diretores de produção" };

/** Só o Admin. Para os outros a página não existe. */
export default async function DirectorsPage() {
  const actor = await requireUser("/diretores");
  if (!actor.isAdmin) notFound();
  const directors = await listDirectors(actor);
  return (
    <>
      <TopBar title="Diretores de produção" subtitle="Gerente em todos os eventos" back="/eventos?todos=1" narrow />
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-4 lg:py-6">
        <p className="text-sm text-muted">
          Quem você cadastrar aqui entra como Gerente em todos os eventos abertos e nos que forem criados depois.
          Um convite só vale para todos. Para tirar o diretor de um evento específico, desative-o em Montar equipe daquele evento.
        </p>
        <DirectorsAdmin directors={directors.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() }))} />
      </main>
    </>
  );
}
