"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/components/api-client";
import { FormError, Label, Textarea } from "@/components/field";
import { Button, cx } from "@/components/ui";
import { RATING_CRITERIA, ratingText, type RatingKey } from "@/modules/suppliers/rating-meta";

type Scores = Record<RatingKey, number | null>;
const NOTES = Array.from({ length: 11 }, (_, i) => i);

/** As 6 notas de 0 a 10 (um toque em cada) e o comentário. */
export function RatingForm({ eventId, supplierId, initial, onDone }: {
  eventId: string; supplierId: string;
  initial: (Record<RatingKey, number> & { comment: string | null }) | null;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [scores, setScores] = useState<Scores>(() =>
    Object.fromEntries(RATING_CRITERIA.map((c) => [c.key, initial ? initial[c.key] : null])) as Scores);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filled = RATING_CRITERIA.filter((c) => scores[c.key] !== null);
  const avg = filled.length === RATING_CRITERIA.length ? filled.reduce((s, c) => s + scores[c.key]!, 0) / filled.length : null;

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (avg === null) return setError("Dê as 6 notas");
        setBusy(true);
        setError(null);
        try {
          const comment = String(new FormData(e.currentTarget).get("comment") ?? "").trim() || null;
          await api(`/api/events/${eventId}/supplier-ratings/${supplierId}`, { method: "PUT", body: { ...scores, comment } });
          router.refresh();
          onDone?.();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {RATING_CRITERIA.map((c) => (
        <fieldset key={c.key}>
          <legend className="mb-1.5 flex w-full justify-between text-sm font-medium">
            <span>{c.label}</span>
            <span className="tabular-nums text-muted">{scores[c.key] ?? "—"}</span>
          </legend>
          <div className="grid grid-cols-11 gap-1">
            {NOTES.map((n) => (
              <button
                key={n} type="button" aria-pressed={scores[c.key] === n} aria-label={`${c.label}: ${n}`}
                onClick={() => setScores((s) => ({ ...s, [c.key]: n }))}
                className={cx(
                  "h-9 rounded-lg border text-sm font-semibold tabular-nums transition",
                  scores[c.key] === n ? "border-primary bg-primary text-primary-foreground"
                    : scores[c.key] !== null && n < scores[c.key]! ? "border-primary/30 bg-primary/15"
                    : "border-border hover:border-primary/60",
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </fieldset>
      ))}
      <label className="block">
        <Label hint="(opcional, só o diretor vê)">Comentário</Label>
        <Textarea name="comment" rows={2} maxLength={1000} defaultValue={initial?.comment ?? ""} placeholder="Ex.: chegou antes do horário e resolveu a queda de energia em 10 minutos" />
      </label>
      <FormError message={error} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy} className="min-h-10 px-4 text-sm">{initial ? "Salvar a correção" : "Salvar a avaliação"}</Button>
        {onDone && <Button type="button" variant="secondary" className="min-h-10 px-3 text-sm" onClick={onDone}>Voltar</Button>}
        <span className="text-sm text-muted">Média: <b className="tabular-nums text-foreground">{avg === null ? "—" : ratingText(avg)}</b></span>
      </div>
    </form>
  );
}

/** Nota já dada: o botão abre o formulário para corrigir. */
export function EditRating(props: Omit<Parameters<typeof RatingForm>[0], "onDone">) {
  const [open, setOpen] = useState(false);
  if (!open) return <Button variant="ghost" className="min-h-9 px-2 text-sm" onClick={() => setOpen(true)}>Corrigir</Button>;
  return <div className="w-full"><RatingForm {...props} onDone={() => setOpen(false)} /></div>;
}
