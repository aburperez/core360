"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/components/api-client";
import { FormError, Input, Label, Textarea } from "@/components/field";
import { Button, cx } from "@/components/ui";
import { BRIEFING_BLOCKS, BRIEFING_TEXT_KEYS } from "@/lib/event-briefing";

export type BriefingData = {
  text: Record<string, string | null>;
  fronts: { key: string; label: string; needed: boolean | null; notes: string | null }[];
};

const NEED = [
  { value: "sim", label: "Precisa", on: "border-cyan-400 bg-cyan-400/15 text-cyan-100" },
  { value: "nao", label: "Não precisa", on: "border-slate-400 bg-white/10 text-slate-100" },
  { value: "", label: "A definir", on: "border-amber-400 bg-amber-400/15 text-amber-100" },
] as const;

const need = (v: boolean | null) => (v === true ? "sim" : v === false ? "nao" : "");

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-4 lg:p-5">
      <h2 className="font-semibold">{title}</h2>
      {hint && <p className="text-sm text-muted">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Uma frente: precisa / não precisa / a definir, e a observação. */
function FrontRow({ front }: { front: BriefingData["fronts"][number] }) {
  const [value, setValue] = useState(need(front.needed));
  return (
    <li className="grid gap-2 py-3 lg:grid-cols-[150px_auto_minmax(0,1fr)] lg:items-center lg:gap-4">
      <p className="font-medium">{front.label}</p>
      <div role="radiogroup" aria-label={`${front.label}: precisa?`} className="flex gap-1.5">
        {NEED.map((o) => (
          <label
            key={o.value}
            className={cx(
              "cursor-pointer rounded-full border px-3 py-1.5 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-cyan-300",
              value === o.value ? o.on : "border-border text-muted hover:text-foreground",
            )}
          >
            <input type="radio" name={`need.${front.key}`} value={o.value} checked={value === o.value} onChange={() => setValue(o.value)} className="sr-only" />
            {o.label}
          </label>
        ))}
      </div>
      <Input name={`notes.${front.key}`} maxLength={2000} defaultValue={front.notes ?? ""} aria-label={`Observação de ${front.label}`} placeholder="Observação (opcional)" />
    </li>
  );
}

/** Formulário do briefing do evento: cliente, evento, local e as 13 frentes. */
export function EventBriefingForm({ eventId, initial }: { eventId: string; initial: BriefingData }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

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
    const body: Record<string, unknown> = Object.fromEntries(BRIEFING_TEXT_KEYS.map((k) => [k, String(f.get(k) ?? "")]));
    body.fronts = initial.fronts.map((fr) => {
      const v = f.get(`need.${fr.key}`);
      return { key: fr.key, needed: v === "sim" ? true : v === "nao" ? false : null, notes: String(f.get(`notes.${fr.key}`) ?? "") };
    });
    setBusy(true);
    setError(null);
    try {
      await api(`/api/events/${eventId}/event-briefing`, { method: "PUT", body });
      setDirty(false);
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} onChange={() => { setDirty(true); setSaved(false); }} className="space-y-4">
      {BRIEFING_BLOCKS.map((b) => (
        <Section key={b.title} title={b.title}>
          <div className="grid gap-3 sm:grid-cols-2">
            {b.fields.map((fl) => (
              <label key={fl.key} className={cx("block", "long" in fl && fl.long && "sm:col-span-2")}>
                <Label>{fl.label}</Label>
                {"hint" in fl && fl.hint && <span className="-mt-1 mb-1 block text-xs text-muted">{fl.hint}</span>}
                {"long" in fl && fl.long ? (
                  <Textarea name={fl.key} maxLength={fl.max} rows={3} defaultValue={initial.text[fl.key] ?? ""} />
                ) : (
                  <Input name={fl.key} maxLength={fl.max} defaultValue={initial.text[fl.key] ?? ""} />
                )}
              </label>
            ))}
          </div>
        </Section>
      ))}

      <Section title="Estrutura" hint="Para cada frente, se o evento precisa e o que o cliente pediu.">
        <ul className="divide-y divide-border">
          {initial.fronts.map((fr) => <FrontRow key={fr.key} front={fr} />)}
        </ul>
      </Section>

      {/* O erro fica na barra de salvar, que está sempre à vista. */}
      <div className="sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-10 space-y-2 rounded-2xl border border-border bg-surface/95 p-3 backdrop-blur lg:bottom-4">
        <FormError message={error} />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</Button>
          <span role="status" className={cx("text-sm", dirty ? "text-amber-200" : saved ? "text-emerald-300" : "text-muted")}>
            {dirty ? "Alterações não salvas" : saved ? "Salvo" : "Nada para salvar"}
          </span>
        </div>
      </div>
    </form>
  );
}
