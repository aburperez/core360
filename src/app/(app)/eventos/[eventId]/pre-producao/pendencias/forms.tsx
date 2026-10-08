"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/components/api-client";
import { FormError, Input, Label, Select } from "@/components/field";
import { Button, Card } from "@/components/ui";
import { useAction } from "../cronograma/forms";

type Option = { id: string; name: string };
type Task = { id: string; title: string; dueOn: string | null; areaId: string | null; responsibleId: string | null };

/** Filtros por área e por responsável (ficam no endereço da página). */
export function Filters({ areas, people, areaId, responsibleId }: { areas: Option[]; people: Option[]; areaId?: string; responsibleId?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const set = (key: string, value: string) => {
    const q = new URLSearchParams(params);
    if (value) q.set(key, value);
    else q.delete(key);
    router.replace(q.size ? `${pathname}?${q}` : pathname);
  };
  return (
    <div className="grid grid-cols-2 gap-2 sm:flex sm:items-end">
      <label className="block sm:w-56">
        <Label>Área</Label>
        <Select value={areaId ?? ""} onChange={(e) => set("area", e.target.value)} aria-label="Filtrar por área">
          <option value="">Todas as áreas</option>
          {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
      </label>
      <label className="block sm:w-56">
        <Label>Responsável</Label>
        <Select value={responsibleId ?? ""} onChange={(e) => set("responsavel", e.target.value)} aria-label="Filtrar por responsável">
          <option value="">Todos</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </label>
    </div>
  );
}

function Fields({ areas, people, initial }: { areas: Option[]; people: Option[]; initial?: Partial<Task> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block sm:col-span-2">
        <Label>Pendência</Label>
        <Input name="title" required maxLength={160} defaultValue={initial?.title ?? ""} placeholder="Ex.: Pedir o alvará dos bombeiros" />
      </label>
      <label className="block">
        <Label hint="(opcional)">Prazo</Label>
        <Input name="dueOn" type="date" defaultValue={initial?.dueOn ?? ""} />
      </label>
      <label className="block">
        <Label hint="(opcional)">Área</Label>
        <Select name="areaId" defaultValue={initial?.areaId ?? ""}>
          <option value="">Sem área</option>
          {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
      </label>
      <label className="block sm:col-span-2">
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
  dueOn: String(f.get("dueOn") ?? "") || null,
  areaId: String(f.get("areaId") ?? "") || null,
  responsibleId: String(f.get("responsibleId") ?? "") || null,
});

function Dialog({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center" role="dialog" aria-label={label}>
      <Card className="w-full max-w-xl">{children}</Card>
    </div>
  );
}

/** Nova pendência manual. */
export function NewTask({ eventId, areas, people }: { eventId: string; areas: Option[]; people: Option[] }) {
  const [open, setOpen] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <>
      <Button className="min-h-10 px-3 text-sm" onClick={() => setOpen(true)}>+ Nova pendência</Button>
      {open && (
        <Dialog label="Nova pendência">
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run(() => api(`/api/events/${eventId}/tasks`, { body: read(new FormData(e.currentTarget)) }))) setOpen(false);
            }}
          >
            <p className="font-semibold">Nova pendência</p>
            <Fields areas={areas} people={people} />
            <FormError message={error} />
            <div className="flex gap-2">
              <Button type="submit" disabled={busy} className="min-h-10 px-3 text-sm">Criar pendência</Button>
              <Button type="button" variant="secondary" className="min-h-10 px-3 text-sm" onClick={() => setOpen(false)}>Voltar</Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}

/** Mudar ou apagar uma pendência manual. */
export function TaskActions({ task, areas, people }: { task: Task; areas: Option[]; people: Option[] }) {
  const [editing, setEditing] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <>
      <Button variant="ghost" className="min-h-8 shrink-0 px-2 text-sm" onClick={() => setEditing(true)}>Mudar</Button>
      {editing && (
        <Dialog label="Mudar pendência">
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run(() => api(`/api/tasks/${task.id}`, { method: "PATCH", body: read(new FormData(e.currentTarget)) }))) setEditing(false);
            }}
          >
            <p className="font-semibold">Mudar a pendência</p>
            <Fields areas={areas} people={people} initial={task} />
            <FormError message={error} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy} className="min-h-10 px-3 text-sm">Salvar</Button>
              <Button type="button" variant="secondary" className="min-h-10 px-3 text-sm" onClick={() => setEditing(false)}>Voltar</Button>
              <Button
                type="button" variant="ghost" disabled={busy} className="ml-auto min-h-10 px-3 text-sm text-red-300"
                onClick={() => { if (confirm(`Apagar a pendência "${task.title}"?`)) run(() => api(`/api/tasks/${task.id}`, { method: "DELETE" })); }}
              >
                Apagar
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
