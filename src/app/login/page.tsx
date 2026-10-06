import { redirect } from "next/navigation";
import { currentActor } from "@/server/http/session";
import { LoginForm } from "./login-form";
import { BrandHero } from "@/components/brand";

export const metadata = { title: "Entrar" };

/** Só caminhos internos: evita mandar a pessoa para outro site depois do login. */
function safeNext(v: string | string[] | undefined) {
  return typeof v === "string" && v.startsWith("/") && !v.startsWith("//") && !v.includes("\\") ? v : "/eventos";
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const next = safeNext((await searchParams).next);
  if (await currentActor()) redirect(next);
  return (
    <main className="min-h-dvh">
      <BrandHero>
        <h1 className="sr-only">CORE 360</h1>
        <p className="mt-3 text-sm font-medium tracking-wide text-brand-cyan">Gestão de campo</p>
      </BrandHero>
      <div className="mx-auto max-w-sm px-5 py-8">
        <LoginForm next={next} />
      </div>
    </main>
  );
}
