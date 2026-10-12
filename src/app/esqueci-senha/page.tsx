import Link from "next/link";
import { connection } from "next/server";
import { BrandHero } from "@/components/brand";
import { emailEnabled } from "@/server/email/email";
import { ForgotForm } from "./forgot-form";

export const metadata = { title: "Esqueci minha senha" };

/** Pedir o link para criar uma senha nova (vai por e-mail). */
export default async function ForgotPage() {
  // Lê a chave do e-mail a cada visita (ligar o Resend não exige publicar de novo).
  await connection();
  const enabled = emailEnabled();
  return (
    <main className="min-h-dvh">
      <BrandHero>
        <h1 className="mt-3 text-lg font-semibold">Esqueci minha senha</h1>
      </BrandHero>
      <div className="mx-auto max-w-sm space-y-4 px-5 py-8">
        {enabled ? (
          <ForgotForm />
        ) : (
          <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-100">
            O envio de e-mail ainda não está ligado. Por enquanto, fale com o diretor de produção da sua agência.
          </p>
        )}
        <p className="text-center text-sm">
          <Link href="/login" className="font-semibold text-primary hover:underline">Voltar para o login</Link>
        </p>
      </div>
    </main>
  );
}
