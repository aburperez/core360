import { RATING_CRITERIA, ratingText, type RatingKey } from "@/modules/suppliers/rating-meta";
import { cx } from "./ui";

const tone = (n: number) => (n >= 8 ? "bg-emerald-500/15 text-emerald-300" : n >= 6 ? "bg-sky-400/15 text-sky-200" : "bg-amber-400/15 text-amber-200");
const bar = (n: number) => (n >= 8 ? "bg-emerald-400" : n >= 6 ? "bg-sky-400" : "bg-amber-400");

/** Nota média (0 a 10) do fornecedor, com quantos eventos entraram nela. */
export function RatingBadge({ value, count, className }: { value: number; count?: number; className?: string }) {
  const title = count === undefined ? `Nota média ${ratingText(value)}` : `Nota média ${ratingText(value)} em ${count} ${count === 1 ? "evento" : "eventos"}`;
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold tabular-nums", tone(value), className)} title={title}>
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
        <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" />
      </svg>
      {ratingText(value)}
      {count !== undefined && <span className="font-medium opacity-80">· {count} {count === 1 ? "evento" : "eventos"}</span>}
    </span>
  );
}

/** As 6 notas, uma barra por critério. */
export function RatingBars({ scores }: { scores: Record<RatingKey, number> }) {
  return (
    <dl className="space-y-2">
      {RATING_CRITERIA.map((c) => (
        <div key={c.key} className="grid grid-cols-[minmax(0,9rem)_1fr_2.5rem] items-center gap-3 text-sm">
          <dt className="truncate text-muted">{c.label}</dt>
          <dd className="h-2 overflow-hidden rounded-full bg-white/10">
            <div className={cx("h-full rounded-full", bar(scores[c.key]))} style={{ width: `${scores[c.key] * 10}%` }} />
          </dd>
          <dd className="text-right font-semibold tabular-nums">{ratingText(scores[c.key])}</dd>
        </div>
      ))}
    </dl>
  );
}
