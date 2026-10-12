"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, LinkButton } from "@/components/ui";
import { FormError, Input, Label } from "@/components/field";

export function ResetForm({ token }: { token: string }) {
  const [done, setDone] = useState(false);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== form.get("confirm")) {
      setError("As senhas não conferem.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newPassword: password, token }),
      });
      if (res.status === 429) throw new Error("Muitas tentativas. Aguarde um minuto e tente de novo.");
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        if (body.code === "PASSWORD_TOO_SHORT") throw new Error("A senha precisa de pelo menos 8 caracteres.");
        if (body.code === "PASSWORD_TOO_LONG") throw new Error("A senha pode ter no máximo 128 caracteres.");
        setExpired(true);
        return;
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof TypeError ? "Sem conexão com o servidor." : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-4">
        <div className="space-y-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
          <p className="font-semibold text-emerald-200">Senha alterada</p>
          <p>Por segurança, a sua conta saiu de todos os aparelhos. Entre de novo com a senha nova.</p>
        </div>
        <LinkButton href="/login" className="w-full">Entrar</LinkButton>
      </div>
    );
  }

  if (expired) {
    return (
      <div className="space-y-3 rounded-xl border border-amber-400/40 bg-amber-400/10 p-4 text-sm text-amber-100">
        <p>Este link expirou ou já foi usado. Cada link vale 1 hora e uma vez só.</p>
        <Link href="/esqueci-senha" className="font-semibold text-primary hover:underline">Pedir outro link</Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <Label hint="(mínimo 8 caracteres)">Senha nova</Label>
        <Input name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} autoFocus />
      </label>
      <label className="block">
        <Label>Repita a senha nova</Label>
        <Input name="confirm" type="password" autoComplete="new-password" required minLength={8} maxLength={128} />
      </label>
      <FormError message={error} />
      <Button type="submit" className="w-full" disabled={busy}>{busy ? "Salvando…" : "Salvar a senha nova"}</Button>
    </form>
  );
}
