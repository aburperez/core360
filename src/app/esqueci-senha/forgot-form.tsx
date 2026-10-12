"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { FormError, Input, Label } from "@/components/field";

export function ForgotForm() {
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/request-password-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.status === 429) throw new Error("Muitos pedidos. Aguarde um minuto e tente de novo.");
      if (!res.ok) throw new Error("Confira o e-mail digitado e tente de novo.");
      setSent(email);
    } catch (err) {
      setError(err instanceof TypeError ? "Sem conexão com o servidor." : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
        <p className="font-semibold text-emerald-200">Pedido recebido</p>
        <p>
          Se <b>{sent}</b> tiver conta no CORE 360, enviamos um link para criar uma senha nova. O link vale 1 hora.
        </p>
        <p className="text-muted">Não chegou? Veja a caixa de spam ou peça de novo daqui a um minuto.</p>
        <button type="button" onClick={() => setSent(null)} className="font-semibold text-primary hover:underline">Pedir de novo</button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-sm text-muted">Digite o e-mail que você usa para entrar. Vamos mandar um link para você criar uma senha nova.</p>
      <label className="block">
        <Label>E-mail</Label>
        <Input name="email" type="email" inputMode="email" autoComplete="username" required autoFocus />
      </label>
      <FormError message={error} />
      <Button type="submit" className="w-full" disabled={busy}>{busy ? "Enviando…" : "Enviar o link"}</Button>
    </form>
  );
}
