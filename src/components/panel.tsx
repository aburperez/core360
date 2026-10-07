import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { cx } from "./ui";

/**
 * Peças dos painéis (Gestão de campo e Pré-produção): barras de progresso,
 * círculos de porcentagem, gráfico de barras e atalhos com ícone.
 */

/** Cores das linhas, na ordem (a primeira é o ciano da marca). */
export const SERIES = [
  { bg: "bg-brand-cyan", soft: "bg-brand-cyan/20", text: "text-brand-cyan", stroke: "stroke-brand-cyan" },
  { bg: "bg-violet-500", soft: "bg-violet-500/20", text: "text-violet-300", stroke: "stroke-violet-400" },
  { bg: "bg-pink-500", soft: "bg-pink-500/20", text: "text-pink-300", stroke: "stroke-pink-400" },
  { bg: "bg-amber-400", soft: "bg-amber-400/20", text: "text-amber-300", stroke: "stroke-amber-400" },
  { bg: "bg-sky-500", soft: "bg-sky-500/20", text: "text-sky-300", stroke: "stroke-sky-400" },
  { bg: "bg-emerald-500", soft: "bg-emerald-500/20", text: "text-emerald-300", stroke: "stroke-emerald-400" },
] as const;

export const serie = (i: number) => SERIES[i % SERIES.length];

export const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

/** Cartão branco-azulado dos painéis, com título opcional. */
export function Panel({ title, action, className, children }: { title?: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cx("rounded-2xl border border-border bg-surface p-4", className)}>
      {title && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Círculo com a letra (como nos cartões da imagem de referência). */
export function Badge({ label, i }: { label: string; i: number }) {
  return (
    <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-brand-navy", serie(i).bg)} aria-hidden>
      {label.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/**
 * Uma linha de progresso: nome à esquerda e a barra com a porcentagem dentro.
 * `hint` é o "x de y" embaixo do nome.
 */
export function ProgressRow({ label, hint, done, total, i, href }: { label: string; hint?: string; done: number; total: number; i: number; href?: string }) {
  const p = pct(done, total);
  const c = serie(i);
  const body = (
    <div className="flex items-center gap-3">
      <Badge label={label} i={i} />
      <div className="w-28 min-w-0 shrink-0 sm:w-40">
        <p className="truncate text-sm font-semibold">{label}</p>
        <p className="truncate text-xs text-muted">{hint ?? `${done} de ${total}`}</p>
      </div>
      <div className={cx("relative flex h-8 flex-1 items-center overflow-hidden rounded-full", c.soft)}>
        {p > 0 && (
          <div className={cx("flex h-full shrink-0 items-center justify-end rounded-full pr-3 transition-all", c.bg)} style={{ width: `${p}%` }}>
            {p >= 30 && <span className="text-sm font-bold text-brand-navy">{p}%</span>}
          </div>
        )}
        {total > 0 && p < 30 && <span className="px-2 text-sm font-bold">{p}%</span>}
        {total === 0 && <span className="px-3 text-xs text-muted">Nada ainda</span>}
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-xl p-1 transition hover:bg-white/5">{body}</Link>
  ) : (
    <div className="p-1">{body}</div>
  );
}

/** Círculo de porcentagem com a legenda embaixo. */
export function Ring({ value, label, i, size = 64 }: { value: number | null; label: string; i: number; size?: number }) {
  const r = 26;
  const len = 2 * Math.PI * r;
  return (
    <div className="flex min-w-0 flex-col items-center gap-1">
      <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label={`${label}: ${value === null ? "sem dados" : `${value}%`}`}>
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="7" className="stroke-border" />
        {value !== null && (
          <circle
            cx="32" cy="32" r={r} fill="none" strokeWidth="7" strokeLinecap="round"
            className={serie(i).stroke}
            strokeDasharray={`${(len * value) / 100} ${len}`}
            transform="rotate(-90 32 32)"
          />
        )}
        <text x="32" y="37" textAnchor="middle" className="fill-foreground text-[14px] font-bold">{value === null ? "—" : `${value}%`}</text>
      </svg>
      <span className="w-full truncate text-center text-xs text-muted">{label}</span>
    </div>
  );
}

/** Barras verticais (ex.: concluídos por equipe). */
export function Bars({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="flex h-40 items-end gap-2">
      {rows.map((r, i) => (
        <div key={r.label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <span className="text-xs font-bold tabular-nums">{r.value}</span>
          <div className={cx("w-full max-w-8 rounded-t-lg", serie(i).bg)} style={{ height: `${Math.max((r.value / max) * 100, 4)}px` }} />
          <span className="w-full truncate text-center text-[11px] text-muted" title={r.label}>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Atalho grande com ícone, nome e uma linha do momento. */
export function Tile({ href, icon, title, line, tone, i = 0 }: { href: string; icon: IconName; title: string; line?: ReactNode; tone?: "alert"; i?: number }) {
  return (
    <Link
      href={href}
      className={cx(
        "flex items-center gap-3 rounded-2xl border bg-surface p-4 transition hover:border-primary/60 active:scale-[0.99]",
        tone === "alert" ? "border-amber-400/50" : "border-border",
      )}
    >
      <span className={cx("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", serie(i).soft, serie(i).text)}>
        <Icon name={icon} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{title}</span>
        {line && <span className={cx("block text-sm leading-snug", tone === "alert" ? "text-amber-200" : "text-muted")}>{line}</span>}
      </span>
      <Icon name="chevron" className="h-5 w-5 shrink-0 text-muted" />
    </Link>
  );
}

/** Quem está vendo: iniciais, nome e papel (topo da coluna da direita). */
export function Profile({ name, role, detail }: { name: string; role: string; detail?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  return (
    <div className="flex items-center gap-3 lg:flex-col lg:text-center">
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-cyan to-violet-500 text-lg font-bold text-brand-navy lg:h-16 lg:w-16">
        {initials}
      </span>
      <div className="min-w-0">
        <p className="truncate text-lg font-bold">{name}</p>
        <p className="truncate text-sm text-muted">{role}{detail ? ` · ${detail}` : ""}</p>
      </div>
    </div>
  );
}

/** Cartão quadrado do celular (grade 2 por linha): ícone grande, nome e número. */
export function SquareTile({ href, icon, title, line, tone, i = 0 }: { href: string; icon: IconName; title: string; line?: ReactNode; tone?: "alert"; i?: number }) {
  return (
    <Link
      href={href}
      className={cx(
        "flex min-h-32 flex-col justify-between gap-3 rounded-2xl border bg-surface p-4 transition hover:border-primary/60 active:scale-[0.98]",
        tone === "alert" ? "border-amber-400/50" : "border-border",
      )}
    >
      <span className={cx("flex h-12 w-12 items-center justify-center rounded-2xl", serie(i).soft, serie(i).text)}>
        <Icon name={icon} className="h-6 w-6" />
      </span>
      <span className="min-w-0">
        <span className="block font-semibold leading-tight">{title}</span>
        {line && <span className={cx("mt-0.5 block text-sm leading-snug", tone === "alert" ? "text-amber-200" : "text-muted")}>{line}</span>}
      </span>
    </Link>
  );
}

/** Título grande da página com o caminho (Evento › Bloco), como na referência. */
export function PageHeading({ trail, title, children }: { trail: string[]; title: string; children?: ReactNode }) {
  return (
    <div className="mb-4 hidden lg:block">
      <p className="text-sm text-muted">{trail.join(" › ")}</p>
      <div className="mt-1 flex items-end justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        {children}
      </div>
    </div>
  );
}

/** Cabeçalho do perfil no celular (faixa da marca com a pessoa). */
export function MobileHero({ name, role, detail }: { name: string; role: string; detail?: string }) {
  return (
    <div className="-mx-4 -mt-4 mb-4 bg-gradient-to-b from-brand-navy to-background px-4 pb-5 pt-4 lg:hidden">
      <Profile name={name} role={role} detail={detail} />
    </div>
  );
}

export type TileData = { href: string; icon: IconName; title: string; line?: string; alert?: boolean };
