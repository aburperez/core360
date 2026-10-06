"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { FormError, Input, Label } from "@/components/field";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      if (res.status === 429) throw new Error("Muitas tentativas. Aguarde um minuto e tente de novo.");
      if (!res.ok) throw new Error("E-mail ou senha inválidos, ou acesso desativado.");
      router.replace("/eventos");
      router.refresh();
    } catch (err) {
      setError(err instanceof TypeError ? "Sem conexão com o servidor." : (err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <Label>E-mail</Label>
        <Input name="email" type="email" inputMode="email" autoComplete="username" required autoFocus />
      </label>
      <label className="block">
        <Label>Senha</Label>
        <Input name="password" type="password" autoComplete="current-password" required minLength={8} />
      </label>
      <FormError message={error} />
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Entrando…" : "Entrar"}
      </Button>
      <p className="text-center text-sm text-muted">
        Recebeu um convite? Abra o link que enviaram para você.
      </p>
    </form>
  );
}
