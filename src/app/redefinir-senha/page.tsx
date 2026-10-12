import Link from "next/link";
import { BrandHero } from "@/components/brand";
import { ResetForm } from "./reset-form";

export const metadata = { title: "Criar nova senha", referrer: "no-referrer" as const };

/** Aberta pelo link do e-mail: a pessoa escolhe a senha nova. */
export default async function ResetPage({ searchParams }: PageProps<"/redefinir-senha">) {
  const { token } = await searchParams;
  const valid = typeof token === "string" && /^[A-Za-z0-9_-]{10,200}$/.test(token);
  return (
    <main className="min-h-dvh">
      <BrandHero>
        <h1 className="mt-3 text-lg font-semibold">Criar nova senha</h1>
      </BrandHero>
      <div className="mx-auto max-w-sm space-y-4 px-5 py-8">
        {valid ? (
          <ResetForm token={token} />
        ) : (
          <div className="space-y-3 rounded-xl border border-amber-400/40 bg-amber-400/10 p-4 text-sm text-amber-100">
            <p>Este link não está completo. Abra de novo o link do e-mail ou peça outro.</p>
            <Link href="/esqueci-senha" className="font-semibold text-primary hover:underline">Pedir outro link</Link>
          </div>
        )}
      </div>
    </main>
  );
}
