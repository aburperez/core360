"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/components/api-client";
import { FormError, Input, Label, Select, Textarea } from "@/components/field";
import { Icon } from "@/components/icons";
import { Button, Card } from "@/components/ui";
import { DEFAULT_VISIT_PPE, PPE_OPTIONS } from "@/modules/visits/ppe";

type Person = { id: string; name: string; role: string };
export type VisitInitial = {
  title: string; place: string | null; date: string; time: string; responsibleId: string;
  ppe: string[]; ppeOther: string | null; notes: string | null;
};

const ROLE = { GERENTE: "Gerente", PRE_PRODUTOR: "Pré-produtor" } as Record<string, string>;

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

function VisitFields({ people, initial }: { people: Person[]; initial: Partial<VisitInitial> }) {
  const checked = new Set(initial.ppe ?? DEFAULT_VISIT_PPE);
  return (
    <>
      <label className="block lg:col-span-2">
        <Label>Visita</Label>
        <Input name="title" required maxLength={120} defaultValue={initial.title} placeholder="Ex.: Visita técnica ao pavilhão" />
      </label>
      <label className="block lg:col-span-2">
        <Label hint="(opcional)">Local</Label>
        <Input name="place" maxLength={200} defaultValue={initial.place ?? ""} placeholder="Endereço ou ponto de encontro" />
      </label>
      <label className="block">
        <Label>Data</Label>
        <Input name="date" type="date" required defaultValue={initial.date} />
      </label>
      <label className="block">
        <Label>Horário</Label>
        <Input name="time" type="time" required defaultValue={initial.time} />
      </label>
      <label className="block lg:col-span-2">
        <Label>Quem vai</Label>
        <Select name="responsibleId" required defaultValue={initial.responsibleId ?? ""}>
          <option value="" disabled>Escolha</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name} · {ROLE[p.role] ?? p.role}</option>)}
        </Select>
      </label>
      <fieldset className="lg:col-span-2">
        <legend className="mb-1 text-sm font-medium">EPIs necessários para a visita</legend>
        <div className="grid gap-1 sm:grid-cols-2">
          {PPE_OPTIONS.map((p) => (
            <label key={p} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 hover:bg-white/5">
              <input type="checkbox" name="ppe" value={p} defaultChecked={checked.has(p)} className="h-5 w-5 accent-[var(--brand-cyan)]" />
              <span>{p}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block lg:col-span-2">
        <Label hint="(opcional)">Outros EPIs ou cuidados</Label>
        <Input name="ppeOther" maxLength={500} defaultValue={initial.ppeOther ?? ""} placeholder="Ex.: lanterna, crachá do recinto" />
      </label>
      <label className="block lg:col-span-2">
        <Label hint="(opcional)">O que verificar</Label>
        <Textarea
          name="notes" maxLength={4000} rows={4} defaultValue={initial.notes ?? ""}
          placeholder="Acessos, carga e descarga, pontos de energia, rotas de fuga, sinal de celular, medidas."
        />
      </label>
    </>
  );
}

const readVisit = (f: FormData) => ({
  title: f.get("title"),
  place: f.get("place") || null,
  scheduledAt: `${f.get("date")}T${f.get("time")}`,
  responsibleId: f.get("responsibleId"),
  ppe: f.getAll("ppe"),
  ppeOther: f.get("ppeOther") || null,
  notes: f.get("notes") || null,
});

/** "+ Nova visita": quem vai, data, horário e EPIs. */
export function NewVisitForm({ eventId, people, me, place }: { eventId: string; people: Person[]; me: string | null; place: string | null }) {
  const [open, setOpen] = useState(false);
  const { busy, error, run } = useAction();
  if (!open) {
    return <Button className="min-h-10 w-full px-4 text-sm lg:w-auto" onClick={() => setOpen(true)}><Icon name="plus" className="h-4 w-4" /> Nova visita</Button>;
  }
  return (
    <Card className="w-full text-left lg:fixed lg:inset-x-0 lg:top-24 lg:z-30 lg:mx-auto lg:max-h-[80vh] lg:max-w-2xl lg:overflow-y-auto lg:shadow-2xl lg:shadow-black/60">
      <form
        className="grid gap-4 lg:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => api(`/api/events/${eventId}/visits`, { body: readVisit(new FormData(e.currentTarget)) }))) setOpen(false);
        }}
      >
        <p className="text-lg font-semibold lg:col-span-2">Nova visita técnica</p>
        <VisitFields people={people} initial={{ responsibleId: people.some((p) => p.id === me) ? me! : "", place }} />
        <div className="lg:col-span-2"><FormError message={error} /></div>
        <div className="flex gap-2 lg:col-span-2">
          <Button type="submit" disabled={busy}>Marcar visita</Button>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
        </div>
      </form>
    </Card>
  );
}

/** Editar ou apagar a visita (gestor, quem marcou ou quem vai). */
export function VisitActions({ id, people, initial }: { id: string; people: Person[]; initial: VisitInitial }) {
  const [open, setOpen] = useState(false);
  const { busy, error, run } = useAction();
  if (!open) {
    return (
      <div className="flex gap-1">
        <Button variant="ghost" className="min-h-9 px-2 text-sm" onClick={() => setOpen(true)}><Icon name="edit" className="h-4 w-4" /> Editar</Button>
        <Button
          variant="ghost" className="min-h-9 px-2 text-sm text-red-300" disabled={busy}
          onClick={() => { if (confirm("Apagar esta visita técnica?")) run(() => api(`/api/visits/${id}`, { method: "DELETE" })); }}
        >
          Apagar
        </Button>
        <FormError message={error} />
      </div>
    );
  }
  return (
    <Card className="mt-3 w-full">
      <form
        className="grid gap-4 lg:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => api(`/api/visits/${id}`, { method: "PATCH", body: readVisit(new FormData(e.currentTarget)) }))) setOpen(false);
        }}
      >
        <VisitFields people={people} initial={initial} />
        <div className="lg:col-span-2"><FormError message={error} /></div>
        <div className="flex gap-2 lg:col-span-2">
          <Button type="submit" disabled={busy}>Salvar</Button>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
        </div>
      </form>
    </Card>
  );
}
