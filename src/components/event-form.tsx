"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui";
import { FormError, Input, Label, Select, Textarea } from "./field";
import { api } from "./api-client";

export const EVENT_STATUS_LABEL: Record<string, string> = {
  PLANEJAMENTO: "Planejamento", PRE_PRODUCAO: "Pré-produção", MONTAGEM: "Montagem", OPERACAO: "Operação",
  DESMONTAGEM: "Desmontagem", FINALIZADO: "Finalizado", CANCELADO: "Cancelado",
};

type Values = {
  name: string; description: string | null; venue: string | null; address: string | null;
  /** "2027-04-10T12:00", no fuso do evento (o servidor converte). */
  startsAt: string; endsAt: string; status?: string;
};

/**
 * Criar evento (com cliente) ou editar os dados e a fase. Data e hora vão sem
 * fuso: o servidor entende no fuso do evento.
 */
export function EventForm({
  mode, eventId, initial, clients,
}: {
  mode: "create" | "edit"; eventId?: string; initial?: Values; clients?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const keys = ["name", "description", "venue", "address", "startsAt", "endsAt", ...(mode === "create" ? ["clientId"] : ["status"])];
        const body = Object.fromEntries(keys.map((k) => [k, String(f.get(k) ?? "")]));
        setBusy(true);
        setError(null);
        setSaved(false);
        try {
          if (mode === "create") {
            const ev = await api<{ id: string }>("/api/events", { body });
            router.push(`/eventos/${ev.id}`);
          } else {
            await api(`/api/events/${eventId}`, { method: "PATCH", body });
            setSaved(true);
            router.refresh();
          }
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {mode === "create" && (
        <label className="block">
          <Label>Cliente</Label>
          <Select name="clientId" required defaultValue="">
            <option value="" disabled>Escolha o cliente</option>
            {clients?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </label>
      )}
      <label className="block">
        <Label>Nome do evento</Label>
        <Input name="name" required maxLength={200} defaultValue={initial?.name ?? ""} placeholder="Ex.: Festival de Verão 2027" />
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <Label>Início</Label>
          <Input name="startsAt" type="datetime-local" required defaultValue={initial?.startsAt ?? ""} />
        </label>
        <label className="block">
          <Label>Fim</Label>
          <Input name="endsAt" type="datetime-local" required defaultValue={initial?.endsAt ?? ""} />
        </label>
      </div>
      <label className="block">
        <Label hint="(opcional)">Local</Label>
        <Input name="venue" maxLength={200} defaultValue={initial?.venue ?? ""} placeholder="Ex.: Expo Center Norte" />
      </label>
      <label className="block">
        <Label hint="(opcional)">Endereço</Label>
        <Input name="address" maxLength={300} defaultValue={initial?.address ?? ""} />
      </label>
      <label className="block">
        <Label hint="(opcional)">Descrição</Label>
        <Textarea name="description" maxLength={2000} defaultValue={initial?.description ?? ""} />
      </label>
      {mode === "edit" && (
        <label className="block">
          <Label>Fase do evento</Label>
          <Select name="status" defaultValue={initial?.status}>
            {Object.entries(EVENT_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </label>
      )}
      <FormError message={error} />
      {saved && <p className="text-sm text-emerald-300">Salvo.</p>}
      <Button type="submit" disabled={busy} className="w-full sm:w-auto">
        {busy ? "Salvando…" : mode === "create" ? "Criar evento" : "Salvar"}
      </Button>
    </form>
  );
}
