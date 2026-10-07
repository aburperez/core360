"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, cx } from "./ui";
import { FormError, Input, Label } from "./field";
import { api } from "./api-client";

/**
 * Peças do painel de funções que aparecem na Pré-produção e no "Meu briefing":
 * a agenda (atividades por dia), o formulário de atividade e a ficha.
 */

export type PlanActivity = {
  id: string; title: string; day: string | null; startTime: string | null; endTime: string | null; place: string | null;
  own: boolean; doneAt?: Date | string | null;
};

export type Profile = {
  document: string | null; uniformSize: string | null; dietary: string | null; emergencyName: string | null; emergencyPhone: string | null;
};

export const UNIFORM_SIZES = ["PP", "P", "M", "G", "GG", "XG", "XGG"];

/** "2027-04-09" → "qui., 09/04". A data é só o dia, sem fuso. */
export function formatDay(day: string | null) {
  if (!day) return "Sem data";
  return new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
}

export function activityWhen(a: Pick<PlanActivity, "startTime" | "endTime">) {
  if (!a.startTime) return null;
  return a.endTime ? `${a.startTime} às ${a.endTime}` : `${a.startTime}`;
}

/** Agrupa por dia, na ordem que chegou (o servidor já ordena). */
export function byDay<T extends { day: string | null }>(list: T[]) {
  const groups: { day: string | null; items: T[] }[] = [];
  for (const a of list) {
    const last = groups.at(-1);
    if (last && last.day === a.day) last.items.push(a);
    else groups.push({ day: a.day, items: [a] });
  }
  return groups;
}

/** A agenda da pessoa, com "feito" que ela mesma marca. */
export function MyAgenda({ eventId, activities }: { eventId: string; activities: PlanActivity[] }) {
  const router = useRouter();
  const [done, setDone] = useState(() => new Set(activities.filter((a) => a.doneAt).map((a) => a.id)));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (id: string) => {
    const next = !done.has(id);
    setBusy(id);
    setError(null);
    try {
      await api(`/api/events/${eventId}/my-plan/activities/${id}`, { method: "PUT", body: { done: next } });
      setDone((s) => {
        const n = new Set(s);
        if (next) n.add(id);
        else n.delete(id);
        return n;
      });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Minha agenda</p>
        <p className="text-sm text-muted tabular-nums">{done.size} de {activities.length} feitas</p>
      </div>
      {byDay(activities).map((g) => (
        <div key={g.day ?? "sem"}>
          <p className="mb-1 text-sm font-semibold capitalize text-primary">{formatDay(g.day)}</p>
          <ul className="divide-y divide-border">
            {g.items.map((a) => {
              const isDone = done.has(a.id);
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    disabled={busy === a.id}
                    onClick={() => toggle(a.id)}
                    aria-pressed={isDone}
                    className="flex min-h-14 w-full items-center gap-3 py-2 text-left"
                  >
                    <span
                      aria-hidden
                      className={cx(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 text-sm font-bold",
                        isDone ? "border-emerald-400 bg-emerald-500/20 text-emerald-300" : "border-border",
                      )}
                    >
                      {isDone ? "✓" : ""}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cx("block font-medium", isDone && "text-muted line-through")}>{a.title}</span>
                      <span className="block text-sm text-muted">{[activityWhen(a), a.place].filter(Boolean).join(" · ") || "Sem horário"}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <FormError message={error} />
    </Card>
  );
}

/** Nova atividade (POST) ou edição (PATCH), com dia, horário e local. */
export function ActivityForm({
  endpoint, method = "POST", initial, onDone, submitLabel = "Adicionar atividade", defaultDay,
}: {
  endpoint: string; method?: "POST" | "PATCH"; initial?: PlanActivity; onDone?: () => void; submitLabel?: string; defaultDay?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        const body = Object.fromEntries(["title", "day", "startTime", "endTime", "place"].map((k) => [k, String(f.get(k) ?? "")]));
        setBusy(true);
        setError(null);
        try {
          await api(endpoint, { method, body });
          if (method === "POST") form.reset();
          onDone?.();
          router.refresh();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="block">
        <Label>Atividade</Label>
        <Input name="title" required maxLength={200} defaultValue={initial?.title ?? ""} placeholder="Ex.: Montar o balcão de credenciamento" />
      </label>
      <div className="grid grid-cols-3 gap-2">
        <label className="block">
          <Label hint="(opcional)">Dia</Label>
          <Input name="day" type="date" defaultValue={initial?.day ?? defaultDay ?? ""} />
        </label>
        <label className="block">
          <Label hint="(opcional)">Início</Label>
          <Input name="startTime" type="time" defaultValue={initial?.startTime ?? ""} />
        </label>
        <label className="block">
          <Label hint="(opcional)">Fim</Label>
          <Input name="endTime" type="time" defaultValue={initial?.endTime ?? ""} />
        </label>
      </div>
      <label className="block">
        <Label hint="(opcional)">Local</Label>
        <Input name="place" maxLength={200} defaultValue={initial?.place ?? ""} placeholder="Ex.: Portão 1" />
      </label>
      <FormError message={error} />
      <div className="flex gap-2">
        {onDone && method === "PATCH" && (
          <Button type="button" variant="secondary" onClick={onDone}>Cancelar</Button>
        )}
        <Button type="submit" disabled={busy}>{busy ? "Salvando…" : submitLabel}</Button>
      </div>
    </form>
  );
}

/**
 * Lista de atividades para a Pré-produção: editar e apagar as que pode.
 * "all" na tela da função; "own" na da pessoa (as da função se mudam na função).
 */
export function ActivityList({ activities, editable: mode, emptyText }: { activities: PlanActivity[]; editable: "all" | "own"; emptyText: string }) {
  const editable = (a: PlanActivity) => mode === "all" || a.own;
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (activities.length === 0) return <p className="text-sm text-muted">{emptyText}</p>;
  return (
    <div className="space-y-4">
      {byDay(activities).map((g) => (
        <div key={g.day ?? "sem"}>
          <p className="mb-1 text-sm font-semibold capitalize text-primary">{formatDay(g.day)}</p>
          <ul className="divide-y divide-border">
            {g.items.map((a) =>
              editing === a.id ? (
                <li key={a.id} className="py-3">
                  <ActivityForm endpoint={`/api/activities/${a.id}`} method="PATCH" initial={a} submitLabel="Salvar" onDone={() => setEditing(null)} />
                </li>
              ) : (
                <li key={a.id} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {a.doneAt && <span className="mr-1 text-emerald-300" title="Feito">✓</span>}
                      {a.title}
                    </span>
                    <span className="block text-sm text-muted">
                      {[activityWhen(a), a.place, !editable(a) && "da função"].filter(Boolean).join(" · ") || "Sem horário"}
                    </span>
                  </span>
                  {editable(a) && (
                    <span className="flex shrink-0 gap-1">
                      <button type="button" className="rounded-lg px-2 py-1.5 text-sm text-primary hover:bg-white/5" onClick={() => setEditing(a.id)}>
                        Editar
                      </button>
                      <button
                        type="button"
                        className="rounded-lg px-2 py-1.5 text-sm text-red-300 hover:bg-white/5"
                        onClick={async () => {
                          if (!confirm(`Apagar “${a.title}”?`)) return;
                          setError(null);
                          try {
                            await api(`/api/activities/${a.id}`, { method: "DELETE" });
                            router.refresh();
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        Apagar
                      </button>
                    </span>
                  )}
                </li>
              ),
            )}
          </ul>
        </div>
      ))}
      <FormError message={error} />
    </div>
  );
}

/** Ficha: documento, uniforme, alimentação e contato de emergência. */
export function ProfileForm({ endpoint, initial, intro }: { endpoint: string; initial: Profile | null; intro?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const v = initial;
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const body = Object.fromEntries(["document", "uniformSize", "dietary", "emergencyName", "emergencyPhone"].map((k) => [k, String(f.get(k) ?? "")]));
        setBusy(true);
        setError(null);
        setSaved(false);
        try {
          await api(endpoint, { method: "PUT", body });
          setSaved(true);
          router.refresh();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {intro && <p className="text-sm text-muted">{intro}</p>}
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <label className="block">
          <Label hint="(RG ou CPF)">Documento</Label>
          <Input name="document" maxLength={30} defaultValue={v?.document ?? ""} autoComplete="off" />
        </label>
        <label className="block">
          <Label>Uniforme</Label>
          <select
            name="uniformSize"
            defaultValue={v?.uniformSize ?? ""}
            className="min-h-12 w-24 appearance-none rounded-xl border border-border bg-surface px-3 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">—</option>
            {UNIFORM_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            {v?.uniformSize && !UNIFORM_SIZES.includes(v.uniformSize) && <option value={v.uniformSize}>{v.uniformSize}</option>}
          </select>
        </label>
      </div>
      <label className="block">
        <Label hint="(opcional)">Restrição alimentar</Label>
        <Input name="dietary" maxLength={200} defaultValue={v?.dietary ?? ""} placeholder="Ex.: vegetariano, alergia a amendoim" />
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <Label>Contato de emergência</Label>
          <Input name="emergencyName" maxLength={120} defaultValue={v?.emergencyName ?? ""} placeholder="Nome" />
        </label>
        <label className="block">
          <Label>Telefone do contato</Label>
          <Input name="emergencyPhone" type="tel" inputMode="tel" maxLength={30} defaultValue={v?.emergencyPhone ?? ""} />
        </label>
      </div>
      <FormError message={error} />
      {saved && <p className="text-sm text-emerald-300">Ficha salva.</p>}
      <Button type="submit" disabled={busy}>{busy ? "Salvando…" : "Salvar ficha"}</Button>
    </form>
  );
}
