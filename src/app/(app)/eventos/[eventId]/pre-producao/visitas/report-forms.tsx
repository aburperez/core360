"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/components/api-client";
import { FormError, Input, Label, Textarea } from "@/components/field";
import { Icon } from "@/components/icons";
import { compressPhoto } from "@/components/photo";
import { Button, cx } from "@/components/ui";

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async <T,>(fn: () => Promise<T>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      router.refresh();
      return r ?? true;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run, router };
}

export type PlaceFieldDef = { key: string; label: string; hint: string };
export type VisitData = {
  id: string; eventId: string; address: string | null; people: string | null;
  status: "ABERTA" | "CONCLUIDA"; canEdit: boolean; fields: Record<string, string | null>;
  photos: { id: string; caption: string | null }[];
};

/** Endereço, quem mais foi e o briefing do lugar. Concluída (ou sem permissão), só leitura. */
export function VisitForm({ visit, placeFields }: { visit: VisitData; placeFields: PlaceFieldDef[] }) {
  const { busy, error, run } = useAction();
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const locked = visit.status === "CONCLUIDA" || !visit.canEdit;

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
    const body: Record<string, unknown> = { address: f.get("address"), people: f.get("people") };
    for (const p of placeFields) body[p.key] = f.get(p.key);
    if (await run(() => api(`/api/visits/${visit.id}/report`, { method: "PATCH", body }))) {
      setDirty(false);
      setSaved(true);
    }
  };

  return (
    <form onSubmit={submit} onChange={() => { setDirty(true); setSaved(false); }} className="space-y-4">
      <fieldset disabled={locked} className="space-y-4">
        <section className="rounded-2xl border border-border bg-surface p-4 lg:p-5">
          <h2 className="font-semibold">Briefing do lugar</h2>
          <p className="mb-3 text-sm text-muted">Preencha no local o que a equipe precisa saber antes de chegar.</p>
          <div className="grid gap-3 lg:grid-cols-2">
            <label className="block">
              <Label>Endereço</Label>
              <Input name="address" maxLength={300} defaultValue={visit.address ?? ""} placeholder="Rua, número, bairro, cidade" />
            </label>
            <label className="block">
              <Label hint="(nomes)">Quem mais foi</Label>
              <Input name="people" maxLength={500} defaultValue={visit.people ?? ""} placeholder="Ex.: Rafael (infra) e o técnico de som" />
            </label>
            {placeFields.map((p) => (
              <label key={p.key} className="block">
                <Label>{p.label}</Label>
                <Textarea name={p.key} rows={4} maxLength={4000} defaultValue={visit.fields[p.key] ?? ""} placeholder={p.hint} />
              </label>
            ))}
          </div>
        </section>
      </fieldset>

      {!locked && (
        <div className="sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-10 flex items-center gap-3 rounded-2xl border border-border bg-surface/95 p-3 backdrop-blur lg:bottom-4">
          <Button type="submit" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</Button>
          <span role="status" className={cx("text-sm", dirty ? "text-amber-200" : "text-muted")}>
            {dirty ? "Alterações não salvas" : saved ? "Salvo" : "Nada para salvar"}
          </span>
        </div>
      )}
      <FormError message={error} />
    </form>
  );
}

const MAX = 40;

/** Fotos com legenda: várias de uma vez, reduzidas no celular antes de subir. */
export function VisitPhotos({ visit, min }: { visit: VisitData; min: number }) {
  const { error, setError, router } = useAction();
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const locked = visit.status === "CONCLUIDA" || !visit.canEdit;
  const count = visit.photos.length;
  const room = MAX - count;

  const upload = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setError(null);
    const take = files.slice(0, Math.max(room, 0));
    const failed: string[] = [];
    setProgress({ done: 0, total: take.length });
    for (const [i, file] of take.entries()) {
      try {
        const { blob } = await compressPhoto(file);
        const form = new FormData();
        form.set("file", blob, "foto.jpg");
        await api(`/api/visits/${visit.id}/photos`, { body: form });
      } catch (e) {
        failed.push((e as Error).message);
      }
      setProgress({ done: i + 1, total: take.length });
    }
    setProgress(null);
    router.refresh();
    const skipped = files.length - take.length;
    const msgs = [
      failed.length && `${failed.length} foto${failed.length > 1 ? "s" : ""} não subiu: ${failed[0]}`,
      skipped > 0 && `${skipped} ficaram de fora: o limite é ${MAX} fotos por visita.`,
    ].filter(Boolean);
    if (msgs.length) setError(msgs.join(" "));
  };

  return (
    <section className="rounded-2xl border border-border bg-surface p-4 lg:p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Fotos do local</h2>
        <span className={cx("text-sm tabular-nums", count >= min ? "text-emerald-300" : "text-amber-200")}>
          {count >= min ? `${count} fotos (máximo ${MAX})` : `${count} de ${min} fotos mínimas`}
        </span>
      </div>
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-white/10" aria-hidden>
        <div className={cx("h-full rounded-full", count >= min ? "bg-emerald-400" : "bg-amber-300")} style={{ width: `${Math.min(100, (count / min) * 100)}%` }} />
      </div>

      {!locked && (
        <>
          <div className="grid grid-cols-2 gap-2 lg:max-w-md">
            <button type="button" disabled={!!progress || room <= 0} onClick={() => camera.current?.click()}
              className="flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border font-semibold disabled:opacity-50">
              <Icon name="camera" className="h-5 w-5" /> Tirar foto
            </button>
            <button type="button" disabled={!!progress || room <= 0} onClick={() => gallery.current?.click()}
              className="flex min-h-14 items-center justify-center gap-2 rounded-xl border border-border text-sm disabled:opacity-50">
              <Icon name="upload" className="h-5 w-5" /> Da galeria
            </button>
          </div>
          <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
          <input ref={gallery} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
          {progress && (
            <p role="status" className="mt-2 text-sm text-brand-cyan">Enviando {progress.done + (progress.done < progress.total ? 1 : 0)} de {progress.total}…</p>
          )}
          {room <= 0 && <p className="mt-2 text-sm text-muted">Chegou ao limite de {MAX} fotos. Remova uma para colocar outra.</p>}
          <FormError message={error} />
        </>
      )}

      {count === 0 ? (
        <p className="mt-4 text-sm text-muted">Nenhuma foto ainda. Fotografe entradas, docas, quadros de energia, banheiros e o espaço de cada área.</p>
      ) : (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {visit.photos.map((p, i) => <PhotoCard key={p.id} photo={p} n={i + 1} locked={locked} />)}
        </ul>
      )}
    </section>
  );
}

function PhotoCard({ photo, n, locked }: { photo: { id: string; caption: string | null }; n: number; locked: boolean }) {
  const { busy, error, run } = useAction();
  const [caption, setCaption] = useState(photo.caption ?? "");
  const [savedCaption, setSavedCaption] = useState(photo.caption ?? "");
  const src = `/api/visit-photos/${photo.id}`;

  const save = async () => {
    if (caption.trim() === savedCaption.trim()) return;
    if (await run(() => api(src, { method: "PATCH", body: { caption } }))) setSavedCaption(caption);
  };
  const remove = async () => {
    if (!confirm(`Remover a foto ${n} da visita?`)) return;
    await run(() => api(src, { method: "DELETE" }));
  };

  return (
    <li className="overflow-hidden rounded-xl border border-border bg-background">
      <a href={src} target="_blank" rel="noreferrer" className="relative block aspect-[4/3] bg-white/5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={caption || `Foto ${n}`} loading="lazy" className="h-full w-full object-cover" />
        <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-semibold tabular-nums text-white">{n}</span>
      </a>
      <div className="space-y-2 p-2">
        {locked ? (
          <p className="min-h-5 text-sm">{photo.caption || <span className="text-muted">Sem legenda</span>}</p>
        ) : (
          <>
            <Input
              aria-label={`Legenda da foto ${n}`} value={caption} maxLength={300} placeholder="Legenda (ex.: doca de carga)"
              onChange={(e) => setCaption(e.target.value)} onBlur={save}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
              className="text-sm"
            />
            <button type="button" onClick={remove} disabled={busy} className="text-sm text-red-300 hover:underline disabled:opacity-50">
              Remover
            </button>
          </>
        )}
        <FormError message={error} />
      </div>
    </li>
  );
}

/** Concluir (com 10 fotos ou mais) ou reabrir. */
export function VisitStatusButton({ visit, min }: { visit: VisitData; min: number }) {
  const { busy, error, run } = useAction();
  const done = visit.status === "CONCLUIDA";
  const missing = Math.max(0, min - visit.photos.length);
  const set = (status: "CONCLUIDA" | "ABERTA") => run(() => api(`/api/visits/${visit.id}/status`, { method: "PUT", body: { status } }));
  if (!visit.canEdit) return null;
  return (
    <div className="space-y-1">
      {done ? (
        <Button type="button" variant="secondary" disabled={busy} onClick={() => set("ABERTA")}>Reabrir para editar</Button>
      ) : (
        <Button type="button" disabled={busy || missing > 0} onClick={() => set("CONCLUIDA")}>Concluir visita</Button>
      )}
      {!done && missing > 0 && <p className="text-sm text-muted">Faltam {missing} foto{missing > 1 ? "s" : ""} para concluir.</p>}
      <FormError message={error} />
    </div>
  );
}
