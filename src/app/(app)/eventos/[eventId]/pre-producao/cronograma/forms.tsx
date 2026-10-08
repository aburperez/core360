"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/components/api-client";
import { FormError, Input, Label, Select } from "@/components/field";
import { Button, Card, cx } from "@/components/ui";

type Person = { id: string; name: string };
type Milestone = { id: string; title: string; dueOn: string; responsibleId: string | null; state: string };

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

/** Bolinha de feito: um toque marca, outro desmarca. */
export function DoneToggle({ id, done, title }: { id: string; done: boolean; title: string }) {
  const { busy, error, run } = useAction();
  return (
    <>
      <button
        type="button" disabled={busy} aria-pressed={done}
        aria-label={done ? `Desmarcar "${title}"` : `Marcar "${title}" como feito`}
        onClick={() => run(() => api(`/api/milestones/${id}/done`, { body: { done: !done } }))}
        className={cx(
          "grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 transition",
          done ? "border-emerald-400 bg-emerald-400 text-background" : "border-border hover:border-primary",
          busy && "opacity-60",
        )}
      >
        {done && (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m5 12 5 5L20 7" />
          </svg>
        )}
      </button>
      {error && <span className="sr-only">{error}</span>}
    </>
  );
}

function Fields({ people, initial }: { people: Person[]; initial?: Partial<Milestone> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_10rem_minmax(0,1fr)]">
      <label className="block">
        <Label>Marco</Label>
        <Input name="title" required maxLength={120} defaultValue={initial?.title ?? ""} placeholder="Ex.: Alvará da prefeitura aprovado" />
      </label>
      <label className="block">
        <Label>Data</Label>
        <Input name="dueOn" type="date" required defaultValue={initial?.dueOn ?? ""} />
      </label>
      <label className="block">
        <Label hint="(opcional)">Responsável</Label>
        <Select name="responsibleId" defaultValue={initial?.responsibleId ?? ""}>
          <option value="">Sem responsável</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </label>
    </div>
  );
}

const read = (f: FormData) => ({
  title: String(f.get("title") ?? ""),
  dueOn: String(f.get("dueOn") ?? ""),
  responsibleId: String(f.get("responsibleId") ?? "") || null,
});

/** Mudar ou apagar um marco. */
export function MilestoneActions({ milestone, people }: { milestone: Milestone; people: Person[] }) {
  const [editing, setEditing] = useState(false);
  const { busy, error, run } = useAction();
  if (editing) {
    return (
      <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center" role="dialog" aria-label="Mudar marco">
      <Card className="w-full max-w-2xl">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => api(`/api/milestones/${milestone.id}`, { method: "PATCH", body: read(new FormData(e.currentTarget)) }))) setEditing(false);
        }}
      >
        <p className="font-semibold">Mudar o marco</p>
        <Fields people={people} initial={milestone} />
        <FormError message={error} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy} className="min-h-10 px-3 text-sm">Salvar</Button>
          <Button type="button" variant="secondary" className="min-h-10 px-3 text-sm" onClick={() => setEditing(false)}>Voltar</Button>
          <Button
            type="button" variant="ghost" disabled={busy} className="ml-auto min-h-10 px-3 text-sm text-red-300"
            onClick={() => { if (confirm(`Apagar o marco "${milestone.title}"?`)) run(() => api(`/api/milestones/${milestone.id}`, { method: "DELETE" })); }}
          >
            Apagar marco
          </Button>
        </div>
      </form>
      </Card>
      </div>
    );
  }
  return <Button variant="ghost" className="min-h-8 shrink-0 px-2 text-sm" onClick={() => setEditing(true)}>Mudar</Button>;
}

/** Novo marco (abre o formulário). */
export function NewMilestone({ eventId, people, defaultDay }: { eventId: string; people: Person[]; defaultDay: string }) {
  const [open, setOpen] = useState(false);
  const { busy, error, run } = useAction();
  if (!open) return <Button variant="secondary" className="min-h-10 px-3 text-sm" onClick={() => setOpen(true)}>+ Novo marco</Button>;
  return (
    <form
      className="w-full space-y-3 rounded-xl border border-border bg-background/40 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => api(`/api/events/${eventId}/milestones`, { body: read(new FormData(e.currentTarget)) }))) setOpen(false);
      }}
    >
      <Fields people={people} initial={{ dueOn: defaultDay }} />
      <FormError message={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy} className="min-h-10 px-3 text-sm">Criar marco</Button>
        <Button type="button" variant="secondary" className="min-h-10 px-3 text-sm" onClick={() => setOpen(false)}>Voltar</Button>
      </div>
    </form>
  );
}

/** Evento sem marcos: cria os padrão de T-30 a T0. */
export function DefaultMilestones({ eventId }: { eventId: string }) {
  const { busy, error, run } = useAction();
  return (
    <div>
      <Button className="min-h-10 px-3 text-sm" disabled={busy} onClick={() => run(() => api(`/api/events/${eventId}/milestones/defaults`, { body: {} }))}>
        Criar os marcos padrão
      </Button>
      <FormError message={error} />
    </div>
  );
}
