"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { listReceipts } from "@/modules/receipts/receipts.service";
import { decimal } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { Button, Card, cx } from "@/components/ui";
import { FormError, Input, Label, Textarea } from "@/components/field";
import { api } from "@/components/api-client";
import { compressPhoto } from "@/components/photo";

type Row = Awaited<ReturnType<typeof listReceipts>>["rows"][number];

type FilterKey = "PENDENTE" | "DIFERENTE" | "OK" | "MONTAR" | "CONFERIR" | "CONFERIDO" | "ALL";

const MATCH: Record<FilterKey, (r: Row) => boolean> = {
  PENDENTE: (r) => r.status === "PENDENTE",
  DIFERENTE: (r) => r.status === "DIFERENTE",
  OK: (r) => r.status === "OK",
  MONTAR: (r) => r.status !== "PENDENTE" && !r.assembledAt,
  CONFERIR: (r) => !!r.assembledAt && !r.checkedAt,
  CONFERIDO: (r) => !!r.checkedAt,
  ALL: () => true,
};

/** Quem só recebe vê a chegada; quem monta (Head da área ou gerente) vê também a montagem. */
const RECEIVE_FILTERS: { key: FilterKey; label: string }[] = [
  { key: "PENDENTE", label: "Aguardando" },
  { key: "DIFERENTE", label: "Diferentes" },
  { key: "OK", label: "Certos" },
  { key: "ALL", label: "Todos" },
];
const ASSEMBLY_FILTERS: { key: FilterKey; label: string }[] = [
  { key: "PENDENTE", label: "Aguardando chegada" },
  { key: "MONTAR", label: "Para montar" },
  { key: "CONFERIR", label: "Para conferir" },
  { key: "CONFERIDO", label: "Conferidos" },
  { key: "ALL", label: "Todos" },
];

const STATUS = {
  PENDENTE: { label: "Aguardando", tone: "bg-white/10 text-muted" },
  OK: { label: "✓ Chegou certo", tone: "bg-emerald-500/15 text-emerald-300" },
  DIFERENTE: { label: "⚠ Chegou diferente", tone: "bg-amber-400/15 text-amber-300" },
  MONTADO: { label: "Montado", tone: "bg-primary/15 text-primary" },
  CONFERIDO: { label: "✓ Conferido", tone: "bg-emerald-500/25 text-emerald-200" },
} as const;

const stageOf = (r: Row) => (r.checkedAt ? "CONFERIDO" : r.assembledAt ? "MONTADO" : r.status);

/** Lista de conferência, agrupada pela seção da planilha. */
export function ReceiptList({ rows, all }: { rows: Row[]; all: boolean }) {
  const assembly = rows.some((r) => r.canAssemble);
  const filters = assembly ? ASSEMBLY_FILTERS : RECEIVE_FILTERS;
  // Abre no que há para fazer: quem monta começa em Para montar; quem recebe, em Aguardando.
  const order: FilterKey[] = assembly ? ["MONTAR", "CONFERIR", "PENDENTE"] : ["PENDENTE", "DIFERENTE"];
  const first = order.map((key) => ({ key })).find((f) => rows.some(MATCH[f.key]));
  const [filter, setFilter] = useState<FilterKey>(first?.key ?? "ALL");
  const shown = rows.filter(MATCH[filter]);
  const sections = [...new Set(shown.map((r) => r.sectionName))];
  const count = (k: FilterKey) => rows.filter(MATCH[k]).length;

  return (
    <>
      <div className="mb-4 flex gap-2 overflow-x-auto" role="tablist">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={cx(
              "min-h-10 shrink-0 rounded-full border px-4 text-sm font-semibold transition",
              filter === f.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface hover:border-primary/60",
            )}
          >
            {f.label} <span className="tabular-nums opacity-70">{count(f.key)}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 && <p className="px-1 text-sm text-muted">Nada aqui.</p>}
      {sections.map((name) => (
        <section key={name} className="mb-6">
          <h2 className="mb-2 px-1 text-sm font-semibold uppercase tracking-wide text-muted">{name}</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {shown.filter((r) => r.sectionName === name).map((r) => <ReceiptCard key={r.id} r={r} all={all} assembly={assembly} />)}
          </div>
        </section>
      ))}
    </>
  );
}

function ReceiptCard({ r, all, assembly }: { r: Row; all: boolean; assembly: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "diff">("view");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qty, setQty] = useState(decimal(r.receivedQuantity ?? r.quantity));
  const [photo, setPhoto] = useState<File | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const assembled = (done: boolean) => run(() => api(`/api/item-receipts/${r.id}/assembled`, { body: { done } }));
  const checked = (file: File) =>
    run(async () => {
      const { blob } = await compressPhoto(file);
      const form = new FormData();
      form.set("file", blob, "conferido.jpg");
      await api(`/api/item-receipts/${r.id}/checked`, { body: form });
    });
  const unchecked = () => run(() => api(`/api/item-receipts/${r.id}/checked`, { method: "DELETE" }));
  const stage = STATUS[stageOf(r)];

  const save = async (body: object, file?: File | null) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/item-receipts/${r.id}/check`, { body });
      if (file) {
        const form = new FormData();
        form.set("file", file);
        await api(`/api/item-receipts/${r.id}/photos`, { body: form });
      }
      setMode("view");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={cx(r.status === "DIFERENTE" && !r.assembledAt && "border-amber-400/40")}>
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 font-semibold">{r.name}</p>
        <span className={cx("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold", stage.tone)}>{stage.label}</span>
      </div>
      <p className="mt-1 text-sm">
        Quantidade: <strong className="tabular-nums">{decimal(r.quantity)}</strong>{r.unit && <> {r.unit}</>}
        {r.location && <span className="text-muted"> · Local: {r.location}</span>}
        {(all || assembly) && r.areaName && <span className="text-muted"> · Área: {r.areaName}</span>}
        {(all || !r.canReceive) && <span className="text-muted"> · Recebe: {r.receiverName}</span>}
      </p>
      {r.description && (
        <details className="mt-1 text-sm text-muted">
          <summary className="cursor-pointer text-primary">Ver descritivo</summary>
          <p className="mt-1 whitespace-pre-line">{r.description}</p>
        </details>
      )}

      {r.status !== "PENDENTE" && (
        <div className="mt-3 border-t border-border pt-3 text-sm">
          {r.status === "DIFERENTE" && (
            <>
              {r.receivedQuantity !== null && <p>Chegou: <strong className="tabular-nums">{decimal(r.receivedQuantity)}</strong> de {decimal(r.quantity)}</p>}
              {r.receivedDescription && <p className="mt-0.5 whitespace-pre-line">{r.receivedDescription}</p>}
            </>
          )}
          {r.note && <p className="mt-0.5 text-muted">&ldquo;{r.note}&rdquo;</p>}
          <p className="mt-1 text-xs text-muted">{r.status === "DIFERENTE" ? "Chegou diferente" : "Chegou certo"} em {formatDateTime(r.receivedAt as Date | string | null)}</p>
          {r.photoIds.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {r.photoIds.map((id, k) => (
                <a key={id} href={`/api/receipt-photos/${id}`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-primary">Foto {k + 1}</a>
              ))}
            </div>
          )}
        </div>
      )}

      {r.status !== "PENDENTE" && (r.assembledAt || r.canAssemble) && (
        <div className="mt-3 border-t border-border pt-3 text-sm">
          {r.assembledAt && <p className="text-xs text-muted">Montado em {formatDateTime(r.assembledAt as Date | string)}</p>}
          {r.checkedAt && (
            <p className="mt-0.5 text-xs text-muted">
              Conferido em {formatDateTime(r.checkedAt as Date | string)}
              {r.checkPhotoIds.map((id, k) => (
                <a key={id} href={`/api/receipt-photos/${id}`} target="_blank" rel="noreferrer" className="ml-2 font-semibold text-primary">
                  Foto{r.checkPhotoIds.length > 1 ? ` ${k + 1}` : ""}
                </a>
              ))}
            </p>
          )}
          {r.canAssemble && mode === "view" && (
            <>
              {!r.assembledAt && (
                <Button className="mt-1 w-full" disabled={busy} onClick={() => assembled(true)}>{busy ? "Salvando…" : "Montado"}</Button>
              )}
              {r.assembledAt && !r.checkedAt && (
                <>
                  <label className={cx("mt-2 flex w-full cursor-pointer", busy && "pointer-events-none opacity-60")}>
                    <span className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-600 px-4 font-semibold text-white hover:bg-emerald-500">
                      {busy ? "Enviando a foto…" : "📷 Conferido (tirar foto)"}
                    </span>
                    <input
                      type="file" accept="image/*" capture="environment" className="sr-only" disabled={busy}
                      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) checked(f); }}
                    />
                  </label>
                  <p className="mt-1 text-xs text-muted">O conferido só vale com a foto do item montado.</p>
                  <button type="button" className="mt-2 font-semibold text-muted hover:text-foreground" disabled={busy} onClick={() => assembled(false)}>
                    Desfazer montado
                  </button>
                </>
              )}
              {r.checkedAt && (
                <button type="button" className="mt-2 font-semibold text-muted hover:text-foreground" disabled={busy} onClick={unchecked}>
                  Desfazer conferido
                </button>
              )}
            </>
          )}
        </div>
      )}

      {mode === "diff" ? (
        <form
          className="mt-3 space-y-3 border-t border-border pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            save({ status: "DIFERENTE", receivedQuantity: qty, receivedDescription: f.get("receivedDescription") || null, note: f.get("note") }, photo);
          }}
        >
          <label className="block">
            <Label>Quantidade que chegou</Label>
            <Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} className="max-w-40 text-right tabular-nums" />
          </label>
          <label className="block">
            <Label hint="(opcional)">O que chegou</Label>
            <Textarea name="receivedDescription" maxLength={2000} defaultValue={r.receivedDescription ?? ""} placeholder="Ex.: painel P3 em vez de P2" className="min-h-16" />
          </label>
          <label className="block">
            <Label>O que está diferente?</Label>
            <Textarea name="note" required maxLength={1000} defaultValue={r.note ?? ""} placeholder="Ex.: veio 1 painel, faltou 1; fornecedor traz amanhã" className="min-h-16" />
          </label>
          <label className="block">
            <Label hint="(opcional)">Foto</Label>
            <input type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} className="block w-full text-sm text-muted file:mr-3 file:min-h-10 file:rounded-xl file:border file:border-border file:bg-surface file:px-3 file:font-semibold file:text-foreground" />
          </label>
          <FormError message={error} />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy} className="flex-1">{busy ? "Salvando…" : "Salvar"}</Button>
            <Button type="button" variant="secondary" onClick={() => setMode("view")}>Cancelar</Button>
          </div>
        </form>
      ) : (
        <>
          <div className="mt-2"><FormError message={error} /></div>
          {!r.canReceive ? (
            r.status === "PENDENTE" && <p className="mt-3 text-sm text-muted">Aguardando quem recebe marcar a chegada.</p>
          ) : r.status === "PENDENTE" ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="success" className="px-2!" disabled={busy} onClick={() => save({ status: "OK" })}>Chegou certo</Button>
              <Button variant="secondary" className="px-2!" disabled={busy} onClick={() => setMode("diff")}>Chegou diferente</Button>
            </div>
          ) : r.assembledAt ? null : (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <button type="button" className="font-semibold text-primary" onClick={() => setMode("diff")}>
                {r.status === "DIFERENTE" ? "Editar diferença" : "Marcar como diferente"}
              </button>
              <button type="button" className="font-semibold text-muted hover:text-foreground" disabled={busy} onClick={() => save({ status: "PENDENTE" })}>
                Desfazer conferência
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
