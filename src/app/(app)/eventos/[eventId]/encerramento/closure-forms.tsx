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

/** Encerrar e apagar: só depois de baixar, com a caixa marcada e o nome do evento digitado. */
export function ClosureForm({ eventId, eventName, parts, downloaded }: { eventId: string; eventName: string; parts: number; downloaded: boolean }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameOk = confirm.trim().toLocaleLowerCase("pt-BR") === eventName.trim().toLocaleLowerCase("pt-BR");

  async function close(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api(`/api/events/${eventId}/close`, { body: { confirm, savedAllParts: saved } });
      router.replace(`/encerrados/${eventId}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (!downloaded) {
    return <p className="text-sm text-muted">Primeiro baixe o histórico. O botão de encerrar aparece depois do download.</p>;
  }
  return (
    <form onSubmit={close} className="space-y-3">
      <p className="text-sm">
        Isto <b className="text-red-300">não tem volta</b>. O evento sai da lista, as pessoas perdem o acesso e as fotos e os arquivos são apagados. Fica só o resumo, em Eventos encerrados.
      </p>
      <label className="flex items-start gap-3 rounded-xl border border-border p-3">
        <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-red-500" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span className="text-sm">Baixei {parts === 1 ? "o histórico" : `as ${parts} partes do histórico`} e guardei num lugar seguro.</span>
      </label>
      <label className="block">
        <Label>Para confirmar, digite o nome do evento: <b className="select-all">{eventName}</b></Label>
        <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" spellCheck={false} />
      </label>
      <FormError message={error} />
      <Button type="submit" variant="danger" className="w-full sm:w-auto" disabled={!saved || !nameOk || busy}>
        {busy ? "Encerrando…" : "Encerrar e apagar"}
      </Button>
    </form>
  );
}
