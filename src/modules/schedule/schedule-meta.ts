/** Cronograma (fase 4A): datas como texto AAAA-MM-DD, no fuso do evento. Sem nada do servidor. */

export type DueState = "FEITO" | "ATRASADO" | "HOJE" | "PROXIMO";

export const DUE_STATE = {
  FEITO: { label: "Feito", tone: "bg-emerald-500/15 text-emerald-300" },
  ATRASADO: { label: "Atrasado", tone: "bg-red-500/15 text-red-300" },
  HOJE: { label: "Vence hoje", tone: "bg-amber-400/15 text-amber-200" },
  PROXIMO: { label: "No prazo", tone: "bg-white/10 text-muted" },
} as const;

/** Dia de hoje (AAAA-MM-DD) no fuso do evento. */
export const todayIn = (timeZone: string, now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);

/** Dias de a até b (b - a). */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** "T-30", "T0", "T+2", contado do primeiro dia do evento. */
export const tLabel = (eventDay: string, day: string) => {
  const n = daysBetween(eventDay, day);
  return n === 0 ? "T0" : n < 0 ? `T${n}` : `T+${n}`;
};

export const dueState = (due: string, today: string, done: boolean): DueState =>
  done ? "FEITO" : due < today ? "ATRASADO" : due === today ? "HOJE" : "PROXIMO";

/** "10/09" ou "10/09/2027". */
export const dayText = (d: string, withYear = false) => {
  const [y, m, dd] = d.split("-");
  return withYear ? `${dd}/${m}/${y}` : `${dd}/${m}`;
};

const WEEKDAY = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export const weekday = (d: string) => WEEKDAY[new Date(`${d}T12:00:00Z`).getUTCDay()]!;
