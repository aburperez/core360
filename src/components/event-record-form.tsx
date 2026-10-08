"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, cx } from "./ui";
import { FormError, Input, Label, Select, Textarea } from "./field";
import { api } from "./api-client";
import { COST_CENTERS, EVENT_STAGES, EVENT_TYPES, UFS } from "@/lib/event-stages";

export type EventRecord = {
  name: string; project: string | null; eventType: string | null; description: string | null; status: string;
  /** Datas e horas como "2027-04-10T12:00", no fuso do evento (o servidor converte). */
  startsAt: string; endsAt: string; setupStartsAt: string; setupEndsAt: string; teardownStartsAt: string; teardownEndsAt: string;
  venue: string | null; address: string | null; city: string | null; state: string | null;
  expectedAudience: number | null; leadId: string | null; producerId: string | null; notes: string | null;
};
type Leader = { id: string; name: string; role: string };
const ROLE = { GERENTE: "Gerente", PRE_PRODUTOR: "Pré-produtor" } as Record<string, string>;

const TEXT_KEYS = [
  "name", "project", "eventType", "description", "status", "startsAt", "endsAt", "setupStartsAt", "setupEndsAt", "teardownStartsAt",
  "teardownEndsAt", "venue", "address", "city", "state", "expectedAudience", "leadId", "producerId", "notes",
] as const;

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-4 lg:p-5">
      <h2 className="font-semibold">{title}</h2>
      {hint && <p className="text-sm text-muted">{hint}</p>}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/**
 * Ficha completa do evento, em blocos: dados gerais, etapa, datas, local,
 * público e responsáveis, valores (só quem é da pré-produção vê) e observações.
 */
export function EventRecordForm({ eventId, initial, leaders, finances }: {
  eventId: string; initial: EventRecord; leaders: Leader[];
  finances: { approvedBudget: string; costCenter: string | null } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  // Não perder o que foi escrito ao sair sem salvar.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body: Record<string, string> = Object.fromEntries(TEXT_KEYS.map((k) => [k, String(f.get(k) ?? "")]));
    if (finances) {
      body.approvedBudget = String(f.get("approvedBudget") ?? "");
      body.costCenter = String(f.get("costCenter") ?? "");
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/api/events/${eventId}`, { method: "PATCH", body });
      setDirty(false);
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const leaderOptions = (
    <>
      <option value="">Ninguém ainda</option>
      {leaders.map((p) => <option key={p.id} value={p.id}>{p.name} · {ROLE[p.role] ?? p.role}</option>)}
    </>
  );

  return (
    <form onSubmit={submit} onChange={() => { setDirty(true); setSaved(false); }} className="space-y-4">
      <Section title="Etapa do evento" hint="Em que ponto do caminho, do briefing ao concluído, o evento está.">
        <label className="block sm:col-span-2">
          <Label>Etapa</Label>
          <Select name="status" defaultValue={initial.status}>
            {EVENT_STAGES.map((s, i) => <option key={s.key} value={s.key}>{i + 1}. {s.label}</option>)}
            <option value="CANCELADO">Cancelado</option>
          </Select>
        </label>
      </Section>

      <Section title="Dados gerais">
        <label className="block sm:col-span-2">
          <Label>Nome do evento</Label>
          <Input name="name" required maxLength={200} defaultValue={initial.name} />
        </label>
        <label className="block">
          <Label hint="(opcional)">Projeto</Label>
          <Input name="project" maxLength={200} defaultValue={initial.project ?? ""} placeholder="Ex.: Turnê 2027" />
        </label>
        <label className="block">
          <Label hint="(opcional)">Tipo de evento</Label>
          <Input name="eventType" maxLength={100} list="event-types" defaultValue={initial.eventType ?? ""} placeholder="Escolha ou escreva" />
          <datalist id="event-types">{EVENT_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
        </label>
        <label className="block sm:col-span-2">
          <Label hint="(opcional)">Descrição</Label>
          <Textarea name="description" maxLength={2000} rows={3} defaultValue={initial.description ?? ""} />
        </label>
      </Section>

      <Section title="Datas" hint="Dia e hora no fuso do evento.">
        <label className="block">
          <Label>Início do evento</Label>
          <Input name="startsAt" type="datetime-local" required defaultValue={initial.startsAt} />
        </label>
        <label className="block">
          <Label>Fim do evento</Label>
          <Input name="endsAt" type="datetime-local" required defaultValue={initial.endsAt} />
        </label>
        <label className="block">
          <Label hint="(opcional)">Início da montagem</Label>
          <Input name="setupStartsAt" type="datetime-local" defaultValue={initial.setupStartsAt} />
        </label>
        <label className="block">
          <Label hint="(opcional)">Fim da montagem</Label>
          <Input name="setupEndsAt" type="datetime-local" defaultValue={initial.setupEndsAt} />
        </label>
        <label className="block">
          <Label hint="(opcional)">Início da desmontagem</Label>
          <Input name="teardownStartsAt" type="datetime-local" defaultValue={initial.teardownStartsAt} />
        </label>
        <label className="block">
          <Label hint="(opcional)">Fim da desmontagem</Label>
          <Input name="teardownEndsAt" type="datetime-local" defaultValue={initial.teardownEndsAt} />
        </label>
      </Section>

      <Section title="Local">
        <label className="block">
          <Label hint="(opcional)">Local</Label>
          <Input name="venue" maxLength={200} defaultValue={initial.venue ?? ""} placeholder="Ex.: Expo Center Norte" />
        </label>
        <label className="block">
          <Label hint="(opcional)">Endereço</Label>
          <Input name="address" maxLength={300} defaultValue={initial.address ?? ""} />
        </label>
        <label className="block">
          <Label hint="(opcional)">Cidade</Label>
          <Input name="city" maxLength={100} defaultValue={initial.city ?? ""} />
        </label>
        <label className="block">
          <Label hint="(opcional)">UF</Label>
          <Select name="state" defaultValue={initial.state ?? ""}>
            <option value="">—</option>
            {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
          </Select>
        </label>
      </Section>

      <Section title="Público e responsáveis" hint="Responsável geral e produtor: Gerente ou Pré-produtor deste evento.">
        <label className="block sm:col-span-2">
          <Label hint="(pessoas)">Público estimado</Label>
          <Input name="expectedAudience" type="number" min={0} step={1} inputMode="numeric" defaultValue={initial.expectedAudience ?? ""} />
        </label>
        <label className="block">
          <Label>Responsável geral</Label>
          <Select name="leadId" defaultValue={initial.leadId ?? ""}>{leaderOptions}</Select>
        </label>
        <label className="block">
          <Label>Produtor responsável</Label>
          <Select name="producerId" defaultValue={initial.producerId ?? ""}>{leaderOptions}</Select>
        </label>
      </Section>

      {finances && (
        <Section title="Valores" hint="Só a pré-produção e os diretores veem. O campo nunca vê valores.">
          <label className="block">
            <Label hint="(R$)">Orçamento aprovado</Label>
            <Input name="approvedBudget" inputMode="decimal" defaultValue={finances.approvedBudget} placeholder="Ex.: 480.000,00" />
          </label>
          <label className="block">
            <Label hint="(opcional)">Centro de custo</Label>
            <Input name="costCenter" maxLength={100} list="cost-centers" defaultValue={finances.costCenter ?? ""} placeholder="Escolha ou escreva" />
            <datalist id="cost-centers">{COST_CENTERS.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
        </Section>
      )}

      <Section title="Observações">
        <label className="block sm:col-span-2">
          <Textarea name="notes" aria-label="Observações" maxLength={4000} rows={4} defaultValue={initial.notes ?? ""} />
        </label>
      </Section>

      {/* O erro fica na barra de salvar, que está sempre à vista. */}
      <div className="sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-10 space-y-2 rounded-2xl border border-border bg-surface/95 p-3 backdrop-blur lg:bottom-4">
        <FormError message={error} />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</Button>
          <span role="status" className={cx("text-sm", dirty ? "text-amber-200" : saved ? "text-emerald-300" : "text-muted")}>
            {dirty ? "Alterações não salvas" : saved ? "Salvo" : "Nada para salvar"}
          </span>
        </div>
      </div>
    </form>
  );
}
