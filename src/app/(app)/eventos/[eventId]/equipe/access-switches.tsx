"use client";

import { useState } from "react";
import { api } from "@/components/api-client";
import { cx } from "@/components/ui";
import { SECTIONS, SECTION_HINT, SECTION_LABEL, type Section } from "@/server/authz/sections";

/**
 * Chaves de acesso de uma pessoa do evento: o que o Cliente vê (Atendimento)
 * e as partes da Pré-produção que o Pré-produtor abre (caixas). Usadas em
 * Montar equipe e na página Atendimento. Quem decide é o servidor.
 */

export type ClientView = { costs: boolean; team: boolean; progress: boolean };
type Guard = (fn: () => Promise<unknown>) => Promise<boolean>;

const VIEW_OPTIONS: { key: keyof ClientView; label: string; hint: string }[] = [
  { key: "progress", label: "Andamento", hint: "chamados e planta" },
  { key: "team", label: "Equipe", hint: "áreas, equipes e pessoas" },
  { key: "costs", label: "Custos", hint: "planilha com valores" },
];

/** O que o Cliente acompanha: ele só olha, e só o que estiver ligado aqui. */
export function ClientViewSwitches({ participantId, view, guard }: {
  participantId: string; view: ClientView; guard: Guard;
}) {
  const [busy, setBusy] = useState<keyof ClientView | null>(null);
  return (
    <div className="mt-3 rounded-xl border border-border bg-background p-3">
      <p className="text-sm font-semibold">O que este cliente vê</p>
      <p className="text-xs text-muted">Ele só olha, não muda nada.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {VIEW_OPTIONS.map((o) => {
          const on = view[o.key];
          return (
            <button
              key={o.key}
              type="button"
              role="switch"
              aria-checked={on}
              disabled={!!busy}
              onClick={async () => {
                setBusy(o.key);
                await guard(() => api(`/api/participants/${participantId}/client-view`, { method: "PATCH", body: { [o.key]: !on } }));
                setBusy(null);
              }}
              className={cx(
                "flex min-h-11 items-center gap-2 rounded-xl border px-3 text-left text-sm transition",
                on ? "border-primary bg-primary/15 text-foreground" : "border-border text-muted hover:border-primary/60",
              )}
            >
              <span aria-hidden className={cx("relative h-5 w-9 shrink-0 rounded-full transition", on ? "bg-primary" : "bg-border")}>
                <span className={cx("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", on ? "left-[18px]" : "left-0.5")} />
              </span>
              <span>
                <span className="block font-medium">{o.label}</span>
                <span className="block text-xs text-muted">{o.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** As caixas de acesso do Pré-produtor: cada parte da Pré-produção que ele abre. */
export function SectionBoxes({ participantId, sections, guard }: { participantId: string; sections: Section[]; guard: Guard }) {
  const [busy, setBusy] = useState(false);
  const on = new Set(sections);
  const save = async (next: Section[]) => {
    setBusy(true);
    await guard(() => api(`/api/participants/${participantId}/sections`, { method: "PUT", body: { sections: next } }));
    setBusy(false);
  };
  return (
    <div className="mt-3 rounded-xl border border-border bg-background p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">O que este produtor abre na Pré-produção</p>
        <span className="text-xs text-muted">{on.size} de {SECTIONS.length}</span>
      </div>
      {on.size === 0 && <p className="text-xs text-amber-300">Nada liberado ainda: ele entra e vê só o aviso.</p>}
      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {SECTIONS.map((s) => {
          const checked = on.has(s);
          return (
            <label key={s} className={cx("flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm transition",
              checked ? "border-primary bg-primary/10" : "border-border hover:border-primary/60", busy && "opacity-60")}>
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                checked={checked}
                disabled={busy}
                onChange={() => save(checked ? sections.filter((x) => x !== s) : [...sections, s])}
              />
              <span className="min-w-0">
                <span className="block font-medium">{SECTION_LABEL[s]}</span>
                <span className="block text-xs text-muted">{SECTION_HINT[s]}</span>
              </span>
            </label>
          );
        })}
      </div>
      <div className="mt-2 flex gap-3 text-xs">
        <button type="button" disabled={busy} className="font-semibold text-primary" onClick={() => save([...SECTIONS])}>Marcar todas</button>
        <button type="button" disabled={busy} className="text-muted" onClick={() => save([])}>Desmarcar todas</button>
      </div>
    </div>
  );
}
