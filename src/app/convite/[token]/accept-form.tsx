"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { FormError, Input, Label } from "@/components/field";
import { api } from "@/components/api-client";

export function AcceptForm({ token, hasAccount, email }: { token: string; hasAccount: boolean; email: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    if (!hasAccount && password !== form.get("confirm")) {
      setError("As senhas não conferem.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/api/invitations/accept", { body: { token, password: hasAccount ? "x".repeat(8) : password } });
      if (hasAccount) {
        router.replace("/login");
        return;
      }
      const res = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      router.replace(res.ok ? "/eventos" : "/login");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (hasAccount) {
    return (
      <form onSubmit={onSubmit} className="space-y-4">
        <p className="text-sm text-muted">Você já tem conta. Confirme para adicionar este evento ao seu acesso e entre com a sua senha de sempre.</p>
        <FormError message={error} />
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Confirmando…" : "Confirmar e entrar"}</Button>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <Label hint="(mínimo 8 caracteres)">Crie sua senha</Label>
        <Input name="password" type="password" autoComplete="new-password" required minLength={8} autoFocus />
      </label>
      <label className="block">
        <Label>Repita a senha</Label>
        <Input name="confirm" type="password" autoComplete="new-password" required minLength={8} />
      </label>
      <FormError message={error} />
      <Button type="submit" className="w-full" disabled={busy}>{busy ? "Salvando…" : "Criar acesso"}</Button>
    </form>
  );
}
