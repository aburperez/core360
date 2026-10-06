"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, cx } from "@/components/ui";
import { FormError, Input, Label, Select, Textarea } from "@/components/field";
import { api } from "@/components/api-client";

const UNITS = [
  { v: 1, l: "minutos" },
  { v: 60, l: "horas" },
  { v: 1440, l: "dias" },
] as const;

/** Prazo em minutos, digitado como "30 minutos" ou "2 horas". */
export function DurationInput({ onChange, required, defaultMinutes }: { onChange: (m: number | null) => void; required?: boolean; defaultMinutes?: number | null }) {
  const start = defaultMinutes && defaultMinutes % 60 === 0 ? (defaultMinutes % 1440 === 0 ? 1440 : 60) : 1;
  const [amount, setAmount] = useState(defaultMinutes ? String(defaultMinutes / start) : "");
  const [unit, setUnit] = useState<number>(start);
  const emit = (a: string, u: number) => {
    const n = Number(a.replace(",", "."));
    onChange(a && n > 0 ? Math.round(n * u) : null);
  };
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
      <Input
        inputMode="decimal"
        value={amount}
        required={required}
        placeholder="Ex.: 30"
        aria-label="Prazo"
        onChange={(e) => { setAmount(e.target.value); emit(e.target.value, unit); }}
      />
      <Select value={unit} aria-label="Unidade" onChange={(e) => { setUnit(Number(e.target.value)); emit(amount, Number(e.target.value)); }}>
        {UNITS.map((u) => <option key={u.v} value={u.v}>{u.l}</option>)}
      </Select>
    </div>
  );
}

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

/** "+ Novo tipo": equipe, nome, descrição e (opcional) o SLA já definido. */
export function NewTypeForm({ eventId, teams }: { eventId: string; teams: { id: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [sla, setSla] = useState<number | null>(null);
  const { busy, error, run } = useAction();
  if (!open) {
    return <Button variant="secondary" className="min-h-10 px-4 text-sm" onClick={() => setOpen(true)}>+ Novo tipo</Button>;
  }
  return (
    <Card className="w-full">
      <form
        className="grid gap-4 lg:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const ok = await run(() => api(`/api/events/${eventId}/service-types`, {
            body: { teamId: f.get("teamId"), name: f.get("name"), description: f.get("description") || null, slaMinutes: sla },
          }));
          if (ok) { setOpen(false); setSla(null); }
        }}
      >
        <label className="block">
          <Label>Equipe que faz</Label>
          <Select name="teamId" required defaultValue={teams.length === 1 ? teams[0].id : ""}>
            <option value="" disabled>Escolha a equipe</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </Select>
        </label>
        <label className="block">
          <Label>Tipo de atendimento</Label>
          <Input name="name" required maxLength={80} placeholder="Ex.: Troca de lâmpada" autoFocus />
        </label>
        <label className="block lg:col-span-2">
          <Label hint="(opcional)">O que inclui</Label>
          <Textarea name="description" maxLength={1000} placeholder="Ex.: lâmpadas do palco e camarins; não inclui refletores" />
        </label>
        <div>
          <Label hint="(opcional: a equipe pode propor depois)">SLA</Label>
          <DurationInput onChange={setSla} />
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit" disabled={busy} className="flex-1">{busy ? "Salvando…" : "Criar tipo"}</Button>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
        </div>
        <div className="lg:col-span-2"><FormError message={error} /></div>
      </form>
    </Card>
  );
}

/** Quem executa propõe; o gestor define na hora. */
export function ProposeForm({ typeId, manager, current }: { typeId: string; manager: boolean; current: number | null }) {
  const [minutes, setMinutes] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [key, setKey] = useState(0);
  const { busy, error, run } = useAction();
  return (
    <form
      key={key}
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!minutes) return;
        const ok = await run(() => api(`/api/service-types/${typeId}/sla`, { body: { minutes, note: note || null } }));
        if (ok) { setMinutes(null); setNote(""); setKey((k) => k + 1); }
      }}
    >
      <div>
        <Label>{manager ? (current ? "Mudar o SLA" : "Definir o SLA") : current ? "Precisa de outro prazo? Proponha aqui" : "Quanto tempo você precisa para atender?"}</Label>
        <DurationInput onChange={setMinutes} required />
      </div>
      <label className="block">
        <Label hint="(opcional)">{manager ? "Observação" : "Por quê? Ajuda o gestor a decidir"}</Label>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="min-h-16" />
      </label>
      <FormError message={error} />
      <Button type="submit" disabled={busy || !minutes} className="w-full">
        {busy ? "Enviando…" : manager ? "Salvar SLA" : "Enviar proposta ao gestor"}
      </Button>
    </form>
  );
}

/** Gestor aprova, ajusta ou recusa; ajuste e recusa pedem comentário. */
export function ReviewForm({ proposalId, proposed }: { proposalId: string; proposed: number }) {
  const [mode, setMode] = useState<"APROVAR" | "AJUSTAR" | "RECUSAR">("APROVAR");
  const [minutes, setMinutes] = useState<number | null>(proposed);
  const [feedback, setFeedback] = useState("");
  const { busy, error, run } = useAction();
  const modes = [
    { v: "APROVAR", l: "Aprovar" },
    { v: "AJUSTAR", l: "Ajustar" },
    { v: "RECUSAR", l: "Recusar" },
  ] as const;
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        await run(() => api(`/api/sla-proposals/${proposalId}/review`, {
          body: { decision: mode, minutes: mode === "AJUSTAR" ? minutes : undefined, feedback: feedback || null },
        }));
      }}
    >
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Decisão">
        {modes.map((m) => (
          <button
            key={m.v}
            type="button"
            role="radio"
            aria-checked={mode === m.v}
            onClick={() => setMode(m.v)}
            className={cx(
              "min-h-11 rounded-xl border text-sm font-semibold transition",
              mode === m.v
                ? m.v === "RECUSAR" ? "border-red-600 bg-red-600 text-white" : "border-primary bg-primary text-primary-foreground"
                : "border-border bg-surface hover:border-primary/60",
            )}
          >
            {m.l}
          </button>
        ))}
      </div>
      {mode === "AJUSTAR" && (
        <div>
          <Label>Novo prazo</Label>
          <DurationInput onChange={setMinutes} required defaultMinutes={proposed} />
        </div>
      )}
      <label className="block">
        <Label hint={mode === "APROVAR" ? "(opcional)" : "(obrigatório)"}>Comentário para a equipe</Label>
        <Textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} maxLength={1000} required={mode !== "APROVAR"} className="min-h-16" />
      </label>
      <FormError message={error} />
      <Button type="submit" disabled={busy || (mode === "AJUSTAR" && !minutes)} variant={mode === "RECUSAR" ? "danger" : "primary"} className="w-full">
        {busy ? "Salvando…" : mode === "APROVAR" ? "Aprovar SLA" : mode === "AJUSTAR" ? "Salvar ajuste" : "Recusar proposta"}
      </Button>
    </form>
  );
}

/** Renomear, descrever ou arquivar o tipo (gestor). */
export function TypeEditor({ typeId, name, description, backHref }: { typeId: string; name: string; description: string | null; backHref: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { busy, error, run } = useAction();
  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className="text-sm font-semibold text-primary">Editar tipo</button>;
  }
  return (
    <form
      className="mt-3 space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (await run(() => api(`/api/service-types/${typeId}`, { method: "PATCH", body: { name: f.get("name"), description: f.get("description") || null } }))) setOpen(false);
      }}
    >
      <Input name="name" defaultValue={name} required maxLength={80} aria-label="Nome" />
      <Textarea name="description" defaultValue={description ?? ""} maxLength={1000} aria-label="O que inclui" />
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>Salvar</Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
        <Button
          type="button"
          variant="ghost"
          className="ml-auto text-red-400"
          disabled={busy}
          onClick={async () => {
            if (!confirm("Arquivar este tipo? Ele sai das listas; chamados antigos continuam com ele.")) return;
            if (await run(() => api(`/api/service-types/${typeId}`, { method: "PATCH", body: { archived: true } }))) router.replace(backHref);
          }}
        >
          Arquivar
        </Button>
      </div>
    </form>
  );
}
