"use client";

import { useState } from "react";
import { api } from "@/components/api-client";
import { Button, Card, SectionTitle } from "@/components/ui";
import { FormError, Input, Label } from "@/components/field";
import { formatPhone } from "@/lib/phone";

/** Ligar ou desligar os avisos no WhatsApp, e em qual número. */
export function WhatsappSettings({ initial }: { initial: { phone: string | null; enabled: boolean } }) {
  const [state, setState] = useState(initial);
  const [phone, setPhone] = useState(initial.phone ? formatPhone(initial.phone) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save(enabled: boolean) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const r = await api<{ phone: string | null; enabled: boolean }>("/api/me/whatsapp", { method: "PUT", body: { phone, enabled } });
      setState(r);
      if (r.phone) setPhone(formatPhone(r.phone));
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <SectionTitle>WhatsApp</SectionTitle>
      <Card className="space-y-3">
        <p className="text-sm text-muted">
          {state.enabled
            ? "Você recebe no WhatsApp os avisos importantes: chamado urgente, atribuído a você, bloqueio e prazo de SLA."
            : "Receba no WhatsApp os avisos importantes, com botão para assumir o chamado sem abrir o app."}
        </p>
        <label className="block">
          <Label>Seu número</Label>
          <Input type="tel" inputMode="tel" autoComplete="tel" placeholder="(11) 98765-4321" value={phone}
            onChange={(e) => { setPhone(e.target.value); setSaved(false); }} />
        </label>
        <FormError message={error} />
        {saved && <p role="status" className="text-sm font-medium text-green-400">{state.enabled ? "Avisos no WhatsApp ligados." : "Avisos no WhatsApp desligados."}</p>}
        <div className="flex flex-wrap gap-2">
          {state.enabled ? (
            <>
              <Button onClick={() => save(true)} disabled={busy} variant="secondary">Salvar número</Button>
              <Button onClick={() => save(false)} disabled={busy} variant="secondary">Desligar</Button>
            </>
          ) : (
            <Button onClick={() => save(true)} disabled={busy || !phone}>Ligar avisos no WhatsApp</Button>
          )}
        </div>
      </Card>
    </section>
  );
}
