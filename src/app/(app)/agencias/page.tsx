import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { listAgencies } from "@/modules/agencies/agencies.service";
import { TopBar } from "@/components/top-bar";
import { SectionTitle } from "@/components/ui";
import { NewAgencyForm } from "./forms";
import { AgencyInvitePanel, type AgencyInviteRow } from "./invite-panel";

export const metadata = { title: "Agências" };

const INVITE_ORDER = { NONE: 0, EXPIRED: 1, SENT: 2, ACCEPTED: 3 } as const;

/** Só o Admin da plataforma. Para os outros a página não existe. */
export default async function AgenciesPage() {
  const actor = await requireUser("/agencias");
  if (!actor.isPlatformAdmin) notFound();
  const agencies = await listAgencies(actor);
  const active = agencies.filter((a) => a.status === "ACTIVE").length;
  // O contato é o primeiro Admin cadastrado (quem abriu a agência com você).
  const rows: AgencyInviteRow[] = agencies
    .map((a) => {
      const admins = a.admins.filter((x) => x.role === "ADMIN");
      const first = [...admins].sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())[0];
      return {
        id: a.id,
        name: a.name,
        status: a.status,
        support: a.admins.some((x) => x.role === "SUPORTE" && x.active),
        directors: admins.filter((x) => x.active).length,
        contact: first
          ? {
              id: first.id, name: first.name, email: first.email, phone: first.phone, active: first.active,
              invite: first.invite, inviteExpiresAt: first.inviteExpiresAt?.toISOString() ?? null,
            }
          : null,
      };
    })
    .sort((x, y) => (x.contact ? INVITE_ORDER[x.contact.invite] : 9) - (y.contact ? INVITE_ORDER[y.contact.invite] : 9));

  return (
    <>
      <TopBar title="Agências" subtitle={`${active} ativas de ${agencies.length}`} back="/eventos?todos=1" narrow />
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-4 lg:py-6">
        <p className="text-sm text-muted">
          Cada agência é um espaço fechado e nenhuma vê a outra. Abra a agência com o contato dela e mande o convite: ele
          vira o Admin da agência e cadastra sozinho os diretores e os produtores.
        </p>
        <NewAgencyForm />
        <SectionTitle>Convites das agências</SectionTitle>
        <AgencyInvitePanel rows={rows} />
      </main>
    </>
  );
}
