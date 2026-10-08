"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, cx } from "@/components/ui";
import { FormError, Input, Label, Textarea } from "@/components/field";
import { api } from "@/components/api-client";

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
  return { busy, error, run, router };
}

/**
 * Click and build: marque as funções da lista padrão que este evento vai ter
 * e crie todas de uma vez. Começa com todas marcadas.
 */
export function DefaultsPicker({ eventId, names, compact }: { eventId: string; names: string[]; compact?: boolean }) {
  const { busy, error, run } = useAction();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(compact ? [] : names));
  const toggle = (n: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  const all = picked.size === names.length;

  return (
    <div className={compact ? "" : "mt-3"}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {compact ? `Faltam ${names.length} da lista padrão` : `${picked.size} de ${names.length} marcadas`}
        </p>
        <button type="button" className="shrink-0 text-sm font-semibold text-primary" onClick={() => setPicked(all ? new Set() : new Set(names))}>
          {all ? "Desmarcar todas" : "Marcar todas"}
        </button>
      </div>
      <ul className="flex flex-wrap gap-2">
        {names.map((n) => {
          const on = picked.has(n);
          return (
            <li key={n}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => toggle(n)}
                className={cx(
                  "min-h-10 rounded-full border px-3 text-sm transition",
                  on ? "border-primary bg-primary/15 font-semibold text-primary" : "border-border bg-surface text-muted hover:border-primary/60",
                )}
              >
                {on ? "✓ " : "+ "}{n}
              </button>
            </li>
          );
        })}
      </ul>
      <Button
        className={cx("mt-3 w-full sm:w-auto", compact && "min-h-10 text-sm")}
        variant={compact ? "secondary" : "primary"}
        disabled={busy || picked.size === 0}
        onClick={() => run(() => api(`/api/events/${eventId}/functions/defaults`, { body: { names: [...picked] } }))}
      >
        {busy ? "Criando…" : `Criar ${picked.size === 1 ? "a função marcada" : `as ${picked.size} funções marcadas`}`}
      </Button>
      <div className="mt-2"><FormError message={error} /></div>
    </div>
  );
}

/** Nova função: só o nome; descrição e atividades na tela da função. */
export function NewFunctionForm({ eventId }: { eventId: string }) {
  const { busy, error, run, router } = useAction();
  return (
    <div>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const name = String(new FormData(e.currentTarget).get("name") ?? "");
          let id: string | null = null;
          const ok = await run(async () => {
            id = (await api<{ id: string }>(`/api/events/${eventId}/functions`, { body: { name } })).id;
          });
          if (ok && id) router.push(`/eventos/${eventId}/pre-producao/funcoes/${id}`);
        }}
      >
        <Input name="name" required maxLength={80} placeholder="Função fora da lista, ex.: Eletricista de palco" aria-label="Nome da nova função" />
        <Button type="submit" disabled={busy} className="shrink-0">{busy ? "…" : "Criar"}</Button>
      </form>
      <div className="mt-2"><FormError message={error} /></div>
    </div>
  );
}

/** Função de uma pessoa, direto no painel. */
export function FunctionSelect({
  eventId, participantId, value, functions, className,
}: { eventId: string; participantId: string; value: string | null; functions: { id: string; name: string }[]; className?: string }) {
  const { busy, error, run } = useAction();
  const [current, setCurrent] = useState(value ?? "");
  return (
    <span className={cx("block", className)}>
      <select
        aria-label="Função"
        value={current}
        disabled={busy}
        onChange={async (e) => {
          const next = e.target.value;
          const prev = current;
          setCurrent(next);
          const ok = await run(() =>
            api(`/api/events/${eventId}/people/${participantId}/function`, { method: "PUT", body: { functionId: next || null } }),
          );
          if (!ok) setCurrent(prev);
        }}
        className={cx(
          "min-h-10 w-full appearance-none rounded-lg border border-border bg-surface px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary",
          !current && "text-muted",
        )}
      >
        <option value="">Sem função</option>
        {functions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>
      {error && <span className="mt-1 block text-xs text-red-300">{error}</span>}
    </span>
  );
}

/** Nome e descrição da função, e apagar. */
export function FunctionEditor({ fn, back }: { fn: { id: string; name: string; description: string | null }; back: string }) {
  const { busy, error, run, router } = useAction();
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setSaved(false);
        const ok = await run(() =>
          api(`/api/functions/${fn.id}`, { method: "PATCH", body: { name: String(f.get("name") ?? ""), description: String(f.get("description") ?? "") } }),
        );
        setSaved(ok);
      }}
    >
      <label className="block">
        <Label>Nome da função</Label>
        <Input name="name" required maxLength={80} defaultValue={fn.name} />
      </label>
      <label className="block">
        <Label hint="(aparece para quem tem a função)">O que essa função faz</Label>
        <Textarea name="description" maxLength={2000} defaultValue={fn.description ?? ""} placeholder="Ex.: Recebe o público no portão, confere a pulseira e orienta o acesso." />
      </label>
      <FormError message={error} />
      {saved && <p className="text-sm text-emerald-300">Salvo.</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</Button>
        <Button
          type="button"
          variant="secondary"
          className="text-red-300"
          disabled={busy}
          onClick={async () => {
            if (!confirm(`Apagar a função “${fn.name}” e as atividades dela? Quem tinha essa função fica sem função.`)) return;
            const ok = await run(() => api(`/api/functions/${fn.id}`, { method: "DELETE" }));
            if (ok) router.push(back);
          }}
        >
          Apagar função
        </Button>
      </div>
    </form>
  );
}

type PickPerson = {
  id: string; name: string; jobTitle: string | null; role: string;
  area: { name: string } | null; team: { id: string; name: string } | null;
  function: { id: string; name: string } | null;
};

/** Quem tem esta função: marque as pessoas (ou a equipe toda) e salve. */
export function PeoplePicker({ functionId, people }: { functionId: string; people: PickPerson[] }) {
  const { busy, error, run } = useAction();
  const initial = useMemo(() => new Set(people.filter((p) => p.function?.id === functionId).map((p) => p.id)), [people, functionId]);
  const [picked, setPicked] = useState(initial);
  const [saved, setSaved] = useState(false);
  const groups = useMemo(() => {
    // Mesma ordem do painel: gestão do evento, Heads de cada área, depois as equipes.
    const m = new Map<string, { label: string; list: PickPerson[] }>();
    for (const p of people) {
      const key = p.role === "GERENTE" ? "0" : p.team ? `2${p.area?.name}${p.team.name}` : `1${p.area?.name ?? ""}`;
      const label = p.role === "GERENTE" ? "Gestão do evento" : p.team ? `${p.area?.name} › ${p.team.name}` : `${p.area?.name ?? "Sem área"} (Heads)`;
      if (!m.has(key)) m.set(key, { label, list: [] });
      m.get(key)!.list.push(p);
    }
    return [...m.entries()].sort(([x], [y]) => x.localeCompare(y, "pt-BR")).map(([, g]) => [g.label, g.list] as const);
  }, [people]);
  const changed = picked.size !== initial.size || [...picked].some((id) => !initial.has(id));
  const moving = people.filter((p) => picked.has(p.id) && p.function && p.function.id !== functionId);

  const toggle = (ids: string[], on: boolean) => {
    setSaved(false);
    setPicked((s) => {
      const n = new Set(s);
      for (const id of ids) {
        if (on) n.add(id);
        else n.delete(id);
      }
      return n;
    });
  };

  if (people.length === 0) return <p className="text-sm text-muted">Ninguém do campo ainda. Monte as equipes em Montar equipe.</p>;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
        {groups.map(([label, list]) => {
          const all = list.every((p) => picked.has(p.id));
          return (
            <Card key={label} className="p-0">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
                <p className="text-sm font-semibold uppercase tracking-wide text-muted">{label}</p>
                <button type="button" className="shrink-0 text-sm font-semibold text-primary" onClick={() => toggle(list.map((p) => p.id), !all)}>
                  {all ? "Desmarcar todos" : "Marcar todos"}
                </button>
              </div>
              <ul className="divide-y divide-border">
                {list.map((p) => (
                  <li key={p.id}>
                    <label className="flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2">
                      <input
                        type="checkbox"
                        className="h-5 w-5 shrink-0 accent-[var(--color-primary)]"
                        checked={picked.has(p.id)}
                        onChange={(e) => toggle([p.id], e.target.checked)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{p.name}</span>
                        <span className="block truncate text-sm text-muted">
                          {p.function && p.function.id !== functionId ? `Hoje: ${p.function.name}` : (p.jobTitle ?? "")}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
      {moving.length > 0 && (
        <p className="rounded-xl bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
          {moving.length === 1 ? `${moving[0].name} sai de “${moving[0].function!.name}”` : `${moving.length} pessoas saem da função que tinham`} e passa{moving.length === 1 ? "" : "m"} para esta.
        </p>
      )}
      <FormError message={error} />
      {saved && !changed && <p className="text-sm text-emerald-300">Salvo. Cada pessoa vê a função e as atividades em “Meu briefing”.</p>}
      <div className="sticky bottom-20 z-10 lg:bottom-4">
        <Button
          className="w-full shadow-lg sm:w-auto"
          disabled={busy || !changed}
          onClick={async () => {
            const ok = await run(() => api(`/api/functions/${functionId}/people`, { method: "PUT", body: { participantIds: [...picked] } }));
            setSaved(ok);
          }}
        >
          {busy ? "Salvando…" : `Salvar (${picked.size} ${picked.size === 1 ? "pessoa" : "pessoas"})`}
        </Button>
      </div>
    </div>
  );
}
