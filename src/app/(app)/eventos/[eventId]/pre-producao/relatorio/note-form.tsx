"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { FormError, Textarea } from "@/components/field";
import { api } from "@/components/api-client";

/** Observações do gestor sobre o dia (vazio apaga). */
export function NoteForm({ eventId, day, initial }: { eventId: string; day: string; initial: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const body = String(new FormData(e.currentTarget).get("body") ?? "");
        setBusy(true);
        setError(null);
        setSaved(false);
        try {
          await api(`/api/events/${eventId}/report/notes/${day}`, { method: "PUT", body: { body } });
          setSaved(true);
          router.refresh();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Textarea name="body" maxLength={5000} defaultValue={initial} onChange={() => setSaved(false)} placeholder="Ex.: Chuva atrasou a montagem em 2 horas; gerador G3 trocado às 15h." className="min-h-32" aria-label="Observações do dia" />
      <FormError message={error} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy} className="min-h-11 text-sm">{busy ? "Salvando…" : "Salvar observações"}</Button>
        {saved && <span className="text-sm text-emerald-300">Salvo.</span>}
      </div>
    </form>
  );
}
