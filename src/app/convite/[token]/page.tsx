import { authPrisma } from "@/server/db/client";
import { previewInvitation } from "@/server/auth/invitations";
import { AcceptForm } from "./accept-form";
import { LinkButton } from "@/components/ui";

export const metadata = { title: "Convite" };

export default async function InvitePage({ params }: PageProps<"/convite/[token]">) {
  const { token } = await params;
  const invite = await previewInvitation(authPrisma(), token).catch(() => null);

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-10">
      <h1 className="text-2xl font-bold">Bem-vindo ao CORE 360</h1>
      {invite ? (
        <>
          <p className="mt-2 text-muted">
            Olá, <strong className="text-foreground">{invite.name}</strong>. Seu acesso é pelo e-mail{" "}
            <strong className="text-foreground">{invite.email}</strong>.
          </p>
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
    </main>
  );
}
