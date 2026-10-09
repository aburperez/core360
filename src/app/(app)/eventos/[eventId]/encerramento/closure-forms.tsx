"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { FormError, Input, Label } from "@/components/field";
import { ApiError, api } from "@/components/api-client";

type Part = { n: number; label: string; files: number; bytes: number };

const mb = (b: number) => `${Math.max(0.1, b / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;

/** Baixa cada parte como arquivo; a primeira baixada marca o histórico como baixado. */
export function HistoryParts({ eventId, parts }: { eventId: string; parts: Part[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [done, setDone] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function download(n: number) {
    setError(null);
    setBusy(n);
    try {
      const res = await fetch(`/api/events/${eventId}/history/${n}`, { credentials: "same-origin" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new ApiError(json?.error?.message ?? "Não foi possível baixar. Tente de novo.", res.status);
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `historico-parte-${n}.zip`;
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement("a"), { href: url, download: name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setDone((d) => [...new Set([...d, n])]);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Sem conexão. Tente de novo quando o sinal voltar.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <FormError message={error} />
      <ul className="divide-y divide-border rounded-xl border border-border">
        {parts.map((p) => (
          <li key={p.n} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <span className="min-w-0">
              <span className="block font-semibold">Parte {p.n} de {parts.length}{done.includes(p.n) && <span className="ml-2 text-sm text-emerald-300">✓ baixada</span>}</span>
              <span className="block text-sm text-muted">{p.label} · {p.files} {p.files === 1 ? "arquivo" : "arquivos"} · {mb(p.bytes)}</span>
            </span>
            <Button variant={done.includes(p.n) ? "secondary" : "primary"} className="min-h-11 shrink-0 text-sm" disabled={busy !== null} onClick={() => download(p.n)}>
              {busy === p.n ? "Preparando…" : done.includes(p.n) ? "Baixar de novo" : "Baixar"}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Encerrar e excluir: com a caixa marcada e o nome do evento digitado. Baixar a cópia antes é opcional. */
export function ClosureForm({ eventId, eventName, downloaded }: { eventId: string; eventName: string; downloaded: boolean }) {
  const router = useRouter();
  const [understood, setUnderstood] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameOk = confirm.trim().toLocaleLowerCase("pt-BR") === eventName.trim().toLocaleLowerCase("pt-BR");

  async function close(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api(`/api/events/${eventId}/close`, { body: { confirm, understood } });
      router.replace(`/encerrados/${eventId}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={close} className="space-y-3">
      <p className="text-sm">
        Só use se a agência não precisa mais do evento no app. Isto <b className="text-red-300">não tem volta</b>: as pessoas perdem o acesso e as fotos, os arquivos e os dados do evento são apagados. Fica só o resumo, em Eventos encerrados.
      </p>
      {!downloaded && (
        <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-100">
          Ninguém baixou a cópia do histórico ainda. Se quiser guardar os arquivos, baixe antes de excluir.
        </p>
      )}
      <label className="flex items-start gap-3 rounded-xl border border-border p-3">
        <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-red-500" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
        <span className="text-sm">Entendo que fotos, arquivos e pessoas do evento serão apagados sem volta.</span>
      </label>
      <label className="block">
        <Label>Para confirmar, digite o nome do evento: <b className="select-all">{eventName}</b></Label>
        <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" spellCheck={false} />
      </label>
      <FormError message={error} />
      <Button type="submit" variant="danger" className="w-full sm:w-auto" disabled={!understood || !nameOk || busy}>
        {busy ? "Excluindo…" : "Encerrar e excluir"}
      </Button>
    </form>
  );
}
