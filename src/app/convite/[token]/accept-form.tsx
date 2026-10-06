"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { FormError, Input, Label } from "@/components/field";
import { api } from "@/components/api-client";
import { formatPhone } from "@/lib/phone";

export function AcceptForm({ token, hasAccount, email, phone }: { token: string; hasAccount: boolean; email: string; phone: string | null }) {
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
    const whatsapp = form.get("whatsapp") === "on" ? { phone: String(form.get("phone") ?? ""), enabled: true } : undefined;
    setBusy(true);
    setError(null);
    try {
      await api("/api/invitations/accept", { body: { token, password: hasAccount ? "x".repeat(8) : password, whatsapp } });
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
        <WhatsappOptIn phone={phone} />
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
      <WhatsappOptIn phone={phone} />
      <FormError message={error} />
      <Button type="submit" className="w-full" disabled={busy}>{busy ? "Salvando…" : "Criar acesso"}</Button>
    </form>
  );
}

/** Aceite opcional dos avisos no WhatsApp (marcado por padrão quando há telefone). */
function WhatsappOptIn({ phone }: { phone: string | null }) {
  const [on, setOn] = useState(!!phone);
  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface p-3">
      <label className="flex items-start gap-3">
        <input type="checkbox" name="whatsapp" checked={on} onChange={(e) => setOn(e.target.checked)} className="mt-1 h-5 w-5 accent-[var(--primary)]" />
        <span>
          <span className="block font-medium">Receber avisos no WhatsApp</span>
          <span className="block text-sm text-muted">Chamado urgente, atribuído a você e prazo de SLA. Dá para desligar quando quiser.</span>
        </span>
      </label>
      {on && (
        <label className="block">
          <Label>Número do WhatsApp</Label>
          <Input name="phone" type="tel" inputMode="tel" autoComplete="tel" required placeholder="(11) 98765-4321"
            defaultValue={phone ? formatPhone(phone) : ""} />
        </label>
      )}
    </div>
  );
}
