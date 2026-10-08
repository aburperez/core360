import { EVENT_STAGES, stageNumber } from "@/lib/event-stages";
import { cx } from "./ui";

/** Em que etapa o evento está: barra no celular, as 11 etapas no computador. */
export function EventStages({ status, className }: { status: string; className?: string }) {
  const n = stageNumber(status);
  if (n === null) {
    return <p className={cx("rounded-2xl border border-border bg-surface p-4 text-sm font-semibold text-muted", className)}>Evento cancelado</p>;
  }
  const total = EVENT_STAGES.length;
  return (
    <section aria-label="Etapa do evento" className={cx("rounded-2xl border border-border bg-surface p-4", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-semibold">{EVENT_STAGES[n - 1]!.label}</p>
        <p className="text-sm tabular-nums text-muted">Etapa {n} de {total}</p>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10 lg:hidden" aria-hidden>
        <div className="h-full rounded-full bg-brand-cyan" style={{ width: `${(n / total) * 100}%` }} />
      </div>
      <ol className="mt-4 hidden grid-cols-11 gap-1 lg:grid">
        {EVENT_STAGES.map((s, i) => {
          const state = i + 1 < n ? "done" : i + 1 === n ? "now" : "next";
          return (
            <li key={s.key} className="min-w-0 text-center" aria-current={state === "now" ? "step" : undefined}>
              <span className={cx("block h-1.5 rounded-full", state === "next" ? "bg-white/10" : "bg-brand-cyan")} />
              <span className={cx("mt-2 block truncate text-xs", state === "now" ? "font-semibold text-brand-cyan" : state === "done" ? "text-foreground" : "text-muted")}>
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
