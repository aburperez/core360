"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { listReceipts } from "@/modules/receipts/receipts.service";
import { decimal } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { Button, Card, cx } from "@/components/ui";
import { FormError, Input, Label, Textarea } from "@/components/field";
import { api } from "@/components/api-client";

type Row = Awaited<ReturnType<typeof listReceipts>>["rows"][number];

const FILTERS = [
  { key: "PENDENTE", label: "Aguardando" },
  { key: "DIFERENTE", label: "Diferentes" },
  { key: "OK", label: "Certos" },
  { key: "ALL", label: "Todos" },
] as const;

const STATUS = {
  PENDENTE: { label: "Aguardando", tone: "bg-white/10 text-muted" },
  OK: { label: "✓ Chegou certo", tone: "bg-emerald-500/15 text-emerald-300" },
  DIFERENTE: { label: "⚠ Chegou diferente", tone: "bg-amber-400/15 text-amber-300" },
} as const;

/** Lista de conferência, agrupada pela seção da planilha. */
export function ReceiptList({ rows, all }: { rows: Row[]; all: boolean }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>(rows.some((r) => r.status === "PENDENTE") ? "PENDENTE" : "ALL");
  const shown = filter === "ALL" ? rows : rows.filter((r) => r.status === filter);
  const sections = [...new Set(shown.map((r) => r.sectionName))];
  const count = (k: string) => (k === "ALL" ? rows.length : rows.filter((r) => r.status === k).length);

  return (
    <>
      <div className="mb-4 flex gap-2 overflow-x-auto" role="tablist">
        {FILTERS.map((f) => (
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
            {shown.filter((r) => r.sectionName === name).map((r) => <ReceiptCard key={r.id} r={r} all={all} />)}
          </div>
        </section>
      ))}
    </>
  );
}

function ReceiptCard({ r, all }: { r: Row; all: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "diff">("view");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qty, setQty] = useState(decimal(r.receivedQuantity ?? r.quantity));
  const [photo, setPhoto] = useState<File | null>(null);

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
    <Card className={cx(r.status === "DIFERENTE" && "border-amber-400/40")}>
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 font-semibold">{r.name}</p>
        <span className={cx("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold", STATUS[r.status].tone)}>{STATUS[r.status].label}</span>
      </div>
      <p className="mt-1 text-sm">
        Quantidade: <strong className="tabular-nums">{decimal(r.quantity)}</strong>
        {all && <span className="text-muted"> · Recebe: {r.receiverName}</span>}
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
          <p className="mt-1 text-xs text-muted">Conferido em {formatDateTime(r.receivedAt as Date | string | null)}</p>
          {r.photoIds.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {r.photoIds.map((id, k) => (
                <a key={id} href={`/api/receipt-photos/${id}`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-primary">Foto {k + 1}</a>
              ))}
            </div>
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
          {r.status === "PENDENTE" ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="success" className="px-2!" disabled={busy} onClick={() => save({ status: "OK" })}>Chegou certo</Button>
              <Button variant="secondary" className="px-2!" disabled={busy} onClick={() => setMode("diff")}>Chegou diferente</Button>
            </div>
          ) : (
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
