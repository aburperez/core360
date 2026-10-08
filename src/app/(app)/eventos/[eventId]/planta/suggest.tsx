"use client";

import { useState } from "react";
import type { suggestPoints } from "@/modules/floorplans/assistant.service";
import { api } from "@/components/api-client";
import { Button, Card, cx } from "@/components/ui";
import { FormError } from "@/components/field";
import { Icon } from "@/components/icons";
import { planForAssistant } from "./prepare";

export type Suggestions = Awaited<ReturnType<typeof suggestPoints>>;
export type Suggestion = Suggestions["suggestions"][number];

/** Cor das sugestões na planta: diferente das situações das etapas. */
export const SUGGESTION_COLOR = "#a855f7";
const KIND = { MONTAGEM: "Montagem", FINALIZACAO: "Finalização" } as const;

/**
 * O Gerente pede sugestões ao assistente, revisa uma por uma e só o que ele
 * aprova vira etapa (pelo mesmo endpoint de "Marcar etapa").
 */
export function SuggestPanel({
  planId, imageSrc, result, onResult, onFocus, onAdded, onClose,
}: {
  planId: string;
  imageSrc: string;
  result: Suggestions | null;
  onResult: (r: Suggestions | null) => void;
  onFocus: (s: Suggestion) => void;
  onAdded: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<"ask" | number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    setBusy("ask");
    setError(null);
    try {
      const form = new FormData();
      form.set("file", await planForAssistant(imageSrc), "planta.jpg");
      onResult(await api<Suggestions>(`/api/floor-plans/${planId}/suggestions`, { body: form }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const drop = (i: number) => result && onResult({ ...result, suggestions: result.suggestions.filter((_, k) => k !== i) });

  const add = async (s: Suggestion, i: number) => {
    setBusy(i);
    setError(null);
    try {
      await api(`/api/floor-plans/${planId}/points`, {
        body: { name: s.name, description: s.description, kind: s.kind, x: s.x, y: s.y, areaId: s.areaId },
      });
      drop(i);
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Sugestões do assistente</h2>
          <p className="mt-0.5 text-sm text-muted">O assistente olha a planta e sugere etapas. Só vira etapa o que você adicionar.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar" className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-white/5">
          <Icon name="close" className="h-5 w-5" />
        </button>
      </div>

      <FormError message={error} />

      {!result ? (
        <Button type="button" className="mt-4 w-full" onClick={ask} disabled={busy !== null}>
          {busy === "ask" ? "Analisando a planta… (pode levar um minuto)" : "Analisar a planta"}
        </Button>
      ) : (
        <div className="mt-4 space-y-3">
          {result.suggestions.length === 0 ? (
            <Card className="text-sm text-muted">Nenhuma sugestão pendente.</Card>
          ) : (
            <ul className="space-y-2">
              {result.suggestions.map((s, i) => (
                <li key={`${s.name}-${s.x}-${s.y}`} className="rounded-2xl border border-border bg-surface p-3">
                  <button type="button" onClick={() => onFocus(s)} className="flex w-full items-start gap-3 text-left">
                    <span
                      className={cx("flex h-8 w-8 shrink-0 items-center justify-center text-sm font-bold text-white", s.kind === "FINALIZACAO" ? "rounded-lg" : "rounded-full")}
                      style={{ background: SUGGESTION_COLOR }}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{s.name}</span>
                      <span className="block text-xs text-muted">{[KIND[s.kind], s.areaName ?? "Sem área"].join(" · ")}</span>
                      {s.description && <span className="mt-1 block text-sm">{s.description}</span>}
                    </span>
                  </button>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Button type="button" variant="secondary" onClick={() => drop(i)} disabled={busy !== null}>Descartar</Button>
                    <Button type="button" onClick={() => add(s, i)} disabled={busy !== null}>{busy === i ? "Adicionando…" : "Adicionar"}</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {result.pending.length > 0 && (
            <div className="rounded-2xl bg-accent/10 p-3 text-sm">
              <p className="font-semibold">O assistente não conseguiu confirmar:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {result.pending.map((p) => <li key={p}>{p}</li>)}
              </ul>
            </div>
          )}
          <Button type="button" variant="ghost" className="w-full" onClick={ask} disabled={busy !== null}>
            {busy === "ask" ? "Analisando…" : "Pedir sugestões de novo"}
          </Button>
        </div>
      )}
    </div>
  );
}
