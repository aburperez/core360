"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/components/api-client";
import { FormError, Input, Label, Select } from "@/components/field";
import { Icon } from "@/components/icons";
import { Button, cx } from "@/components/ui";
import { DOCUMENT_ACCEPT, DOCUMENT_CATEGORIES, formatBytes } from "@/lib/documents";

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
  return { busy, error, setError, run };
}

function ReleaseBox({ defaultChecked }: { defaultChecked?: boolean }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name="visibleToField" defaultChecked={defaultChecked} className="mt-0.5 h-4 w-4 accent-[var(--primary)]" />
      <span>
        <b>Liberar para o campo</b>
        <span className="block text-muted">Heads e Operacionais leem, mas não trocam nem apagam.</span>
      </span>
    </label>
  );
}

/** Enviar um documento: arquivo, categoria, nome (opcional) e, para o gestor, liberar para o campo. */
export function UploadForm({ eventId, canRelease, maxBytes }: { eventId: string; canRelease: boolean; maxBytes: number }) {
  const { busy, error, setError, run } = useAction();
  const form = useRef<HTMLFormElement>(null);
  const [picked, setPicked] = useState<File | null>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const file = f.get("file");
    if (!(file instanceof File) || !file.size) return setError("Escolha o arquivo");
    if (file.size > maxBytes) return setError(`Arquivo maior que ${formatBytes(maxBytes)}`);
    f.set("visibleToField", f.get("visibleToField") ? "true" : "false");
    if (await run(() => api(`/api/events/${eventId}/documents`, { method: "POST", body: f }))) {
      form.current?.reset();
      setPicked(null);
    }
  };

  return (
    <form ref={form} onSubmit={submit} className="space-y-3 rounded-2xl border border-border bg-surface p-4 lg:p-5">
      <h2 className="font-semibold">Enviar documento</h2>
      <label className="flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-dashed border-border px-4 py-5 text-center hover:border-primary">
        <Icon name="upload" className="h-6 w-6 text-primary" />
        <span className="font-medium">{picked ? picked.name : "Escolher arquivo"}</span>
        <span className="text-xs text-muted">
          {picked ? formatBytes(picked.size) : `PDF, imagem, Word, Excel ou PowerPoint, até ${formatBytes(maxBytes)}`}
        </span>
        <input name="file" type="file" accept={DOCUMENT_ACCEPT} className="sr-only" onChange={(e) => setPicked(e.target.files?.[0] ?? null)} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <Label>Categoria</Label>
          <Select name="category" required defaultValue="">
            <option value="" disabled>Escolha</option>
            {DOCUMENT_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </Select>
        </label>
        <label className="block">
          <Label hint="(opcional)">Nome</Label>
          <Input name="title" maxLength={200} placeholder="Se vazio, usa o nome do arquivo" />
        </label>
      </div>
      {canRelease && <ReleaseBox />}
      <FormError message={error} />
      <Button type="submit" disabled={busy}>{busy ? "Enviando…" : "Enviar"}</Button>
    </form>
  );
}

export type DocRow = {
  id: string; category: string; title: string; visibleToField: boolean; canDelete: boolean;
};

/** Editar (nome, categoria, liberar) e apagar um documento. */
export function DocumentActions({ doc, canRelease }: { doc: DocRow; canRelease: boolean }) {
  const { busy, error, run } = useAction();
  const [open, setOpen] = useState(false);

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body: Record<string, unknown> = { title: f.get("title"), category: f.get("category") };
    if (canRelease) body.visibleToField = !!f.get("visibleToField");
    if (await run(() => api(`/api/documents/${doc.id}`, { method: "PATCH", body }))) setOpen(false);
  };
  const remove = () => {
    if (!confirm(`Apagar "${doc.title}"? Não dá para desfazer.`)) return;
    void run(() => api(`/api/documents/${doc.id}`, { method: "DELETE" }));
  };

  return (
    <>
      <div className="flex shrink-0 gap-1">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="rounded-lg px-2 py-1 text-sm text-primary hover:bg-white/5">
          {open ? "Fechar" : "Editar"}
        </button>
        {doc.canDelete && (
          <button type="button" onClick={remove} disabled={busy} className="rounded-lg px-2 py-1 text-sm text-red-300 hover:bg-white/5">
            Apagar
          </button>
        )}
      </div>
      {open && (
        <form onSubmit={save} className="col-span-full mt-2 space-y-3 rounded-xl border border-border p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <Label>Nome</Label>
              <Input name="title" required maxLength={200} defaultValue={doc.title} />
            </label>
            <label className="block">
              <Label>Categoria</Label>
              <Select name="category" defaultValue={doc.category}>
                {DOCUMENT_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </Select>
            </label>
          </div>
          {canRelease && <ReleaseBox defaultChecked={doc.visibleToField} />}
          <Button type="submit" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</Button>
        </form>
      )}
      {!open && error && <p className={cx("col-span-full text-sm text-red-300")}>{error}</p>}
      {open && <div className="col-span-full"><FormError message={error} /></div>}
    </>
  );
}
