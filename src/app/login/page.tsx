import { redirect } from "next/navigation";
import { currentActor } from "@/server/http/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "Entrar" };

export default async function LoginPage() {
  if (await currentActor()) redirect("/eventos");
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-10">
      <div className="mb-8 flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" className="h-12 w-12" />
        <div>
          <h1 className="text-2xl font-bold">CORE 360</h1>
          <p className="text-sm text-muted">Gestão de campo</p>
        </div>
      </div>
      <LoginForm />
    </main>
  );
}
