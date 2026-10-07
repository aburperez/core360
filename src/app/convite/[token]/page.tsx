import { authPrisma } from "@/server/db/client";
import { previewInvitation } from "@/server/auth/invitations";
import { AcceptForm } from "./accept-form";
import { LinkButton } from "@/components/ui";
import { BrandHero } from "@/components/brand";

export const metadata = { title: "Convite" };

export default async function InvitePage({ params }: PageProps<"/convite/[token]">) {
  const { token } = await params;
  const invite = await previewInvitation(authPrisma(), token).catch(() => null);

  return (
    <main className="min-h-dvh">
      <BrandHero />
      <div className="mx-auto max-w-sm px-5 py-8">
        <h1 className="text-2xl font-bold">Bem-vindo ao CORE 360</h1>
        {invite ? (
          <>
            <p className="mt-2 text-muted">
              Olá, <strong className="text-foreground">{invite.name}</strong>. Seu acesso é pelo e-mail{" "}
              <strong className="text-foreground">{invite.email}</strong>.
            </p>
            {invite.agency && (
              <p className="mt-2 text-muted">
                Você foi convidado como Admin da agência <strong className="text-foreground">{invite.agency}</strong>.
              </p>
            )}
            <div className="mt-6">
              <AcceptForm token={token} hasAccount={invite.hasAccount} email={invite.email} phone={invite.phone} />
            </div>
          </>
        ) : (
          <>
            <p className="mt-2 text-muted">Este convite é inválido, já foi usado ou expirou. Peça um novo link a quem cadastrou você.</p>
            <LinkButton href="/login" variant="secondary" className="mt-6">Ir para o login</LinkButton>
          </>
        )}
      </div>
    </main>
  );
}
