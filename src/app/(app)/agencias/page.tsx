import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { listAgencies } from "@/modules/agencies/agencies.service";
import { TopBar } from "@/components/top-bar";
import { EmptyState, SectionTitle, cx } from "@/components/ui";
import { NewAgencyForm } from "./forms";

export const metadata = { title: "Agências" };

/** Só o Admin da plataforma. Para os outros a página não existe. */
export default async function AgenciesPage() {
  const actor = await requireUser("/agencias");
  if (!actor.isPlatformAdmin) notFound();
  const agencies = await listAgencies(actor);
  const active = agencies.filter((a) => a.status === "ACTIVE").length;

  return (
    <>
      <TopBar title="Agências" subtitle={`${active} ativas de ${agencies.length}`} back="/eventos?todos=1" narrow />
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-4 lg:py-6">
        <p className="text-sm text-muted">
          Cada agência é um espaço fechado: os diretores de produção dela criam clientes e eventos, e nenhuma vê a outra.
          Crie a agência com o primeiro diretor de produção e mande o link de convite para ele.
        </p>
        <NewAgencyForm />
        <SectionTitle>Agências ({agencies.length})</SectionTitle>
        {agencies.length === 0 ? (
          <EmptyState title="Nenhuma agência ainda">Crie a primeira acima.</EmptyState>
        ) : (
          <ul className="space-y-2">
            {agencies.map((a) => {
              const admins = a.admins.filter((x) => x.role === "ADMIN");
              const linked = admins.filter((x) => x.active && x.linked).length;
              const support = a.admins.some((x) => x.role === "SUPORTE" && x.active);
              return (
                <li key={a.id}>
                  <Link
                    href={`/agencias/${a.id}`}
                    className={cx(
                      "flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4 transition hover:border-primary/60",
                      a.status === "SUSPENDED" && "opacity-70",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{a.name}</span>
                      <span className="block truncate text-sm text-muted">
                        {admins.length} {admins.length === 1 ? "diretor" : "diretores"} · {linked} com acesso
                      </span>
                      <span className={cx("block truncate text-sm", support ? "text-emerald-300" : "text-amber-300")}>
                        {support ? "Suporte autorizado" : "Sem Suporte autorizado"}
                      </span>
                    </span>
                    <span
                      className={cx(
                        "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
                        a.status === "ACTIVE" ? "bg-emerald-500/20 text-emerald-200" : "bg-red-500/20 text-red-200",
                      )}
                    >
                      {a.status === "ACTIVE" ? "Ativa" : "Suspensa"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
