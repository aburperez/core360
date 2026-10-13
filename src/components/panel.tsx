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

/**
 * Cores dos círculos dos cartões de seção (na ordem), no estilo da grade de
 * pastas: anel colorido, miolo cheio e o ícone branco no meio.
 */
export const RING_COLORS = ["#00c9d1", "#8b5cf6", "#f2762e", "#f2a900", "#11968f", "#22a55b", "#2f7de1", "#e0457b", "#64748b"] as const;

export const ringColor = (i: number) => RING_COLORS[((i % RING_COLORS.length) + RING_COLORS.length) % RING_COLORS.length];

/** Ícone grande e redondo dos cartões. `size` "sm" para listas e para o celular apertado. */
export function RoundIcon({ icon, i = 0, size = "lg" }: { icon: IconName; i?: number; size?: "lg" | "sm" }) {
  const c = ringColor(i);
  return (
    <span
      className={cx("grid shrink-0 place-items-center rounded-full bg-background", size === "lg" ? "h-[76px] w-[76px] border-[5px]" : "h-12 w-12 border-[3px]")}
      style={{ borderColor: c }}
      aria-hidden
    >
      <span className={cx("grid place-items-center rounded-full text-white", size === "lg" ? "h-[54px] w-[54px]" : "h-[34px] w-[34px]")} style={{ background: c }}>
        <Icon name={icon} className={size === "lg" ? "h-7 w-7" : "h-[18px] w-[18px]"} />
      </span>
    </span>
  );
}

/**
 * Cartão de seção: o círculo com o ícone em cima e, embaixo, o nome e uma
 * linha do momento, com o pontinho de cor (amarelo quando pede atenção).
 */
export function SectionCard({ href, icon, title, line, tone, i = 0 }: { href: string; icon: IconName; title: string; line?: ReactNode; tone?: "alert"; i?: number }) {
  return (
    <Link
      href={href}
      className={cx(
        "group flex flex-col overflow-hidden rounded-xl border bg-surface transition hover:border-primary/70 hover:bg-surface/80 active:scale-[0.98]",
        tone === "alert" ? "border-amber-400/60" : "border-border",
      )}
    >
      <span className="grid h-28 place-items-center transition group-hover:scale-[1.04]">
        <RoundIcon icon={icon} i={i} />
      </span>
      <span className="flex min-w-0 items-start gap-2 px-3 pb-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{title}</span>
          {line && <span className={cx("mt-0.5 line-clamp-2 block text-xs leading-snug", tone === "alert" ? "text-amber-200" : "text-muted")}>{line}</span>}
        </span>
        <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", tone === "alert" && "bg-amber-400")} style={tone === "alert" ? undefined : { background: ringColor(i) }} aria-hidden />
      </span>
    </Link>
  );
}

/** Grade dos cartões: 2 por linha no celular e quantos couberem no computador. */
export function SectionGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]", className)}>{children}</div>;
}

/** Os atalhos antigos agora são cartões de seção. */
export const Tile = SectionCard;

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

export const SquareTile = SectionCard;

/**
 * Título grande da página no computador. O caminho (Evento › Bloco) fica na
 * linha de navegação embaixo da barra do topo; aqui ele vira a descrição.
 */
export function PageHeading({ trail, title, children }: { trail: string[]; title: string; children?: ReactNode }) {
  return (
    <div className="mb-5 hidden lg:block">
      <div className="flex items-end justify-between gap-4">
        <h2 className="text-3xl font-bold tracking-tight">{title}</h2>
        {children}
      </div>
      <p className="mt-1 text-muted">{trail.join(" › ")}</p>
    </div>
  );
}

export type TileData = { href: string; icon: IconName; title: string; line?: string; alert?: boolean };
