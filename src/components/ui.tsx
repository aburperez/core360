import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { OccurrenceStatus, Priority } from "../generated/prisma/enums";
import { PRIORITY_LABEL, PRIORITY_STYLE, STATUS_LABEL, STATUS_STYLE, slaText } from "../lib/format";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Card({ className, ...p }: ComponentProps<"div">) {
  return <div className={cx("rounded-2xl border border-border bg-surface p-4", className)} {...p} />;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between px-1">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{children}</h2>
      {action}
    </div>
  );
}

export function StatusBadge({ status }: { status: OccurrenceStatus }) {
  return (
    <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", STATUS_STYLE[status])}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function PriorityText({ priority }: { priority: Priority }) {
  return <span className={cx("text-xs", PRIORITY_STYLE[priority])}>{PRIORITY_LABEL[priority]}</span>;
}

export function SlaPill({ dueAt, closed }: { dueAt: Date | string | null; closed?: boolean }) {
  if (closed) return null;
  const s = slaText(dueAt);
  if (s.tone === "none") return null;
  const tone = {
    ok: "text-emerald-700 dark:text-emerald-300",
    warn: "text-orange-600 dark:text-orange-300",
    late: "text-red-600 dark:text-red-400 font-semibold",
    none: "",
  }[s.tone];
  return <span className={cx("text-xs", tone)}>⏱ {s.text}</span>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Card className="text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </Card>
  );
}

const buttonStyles = {
  primary: "bg-primary text-primary-foreground",
  secondary: "border border-border bg-surface text-foreground",
  danger: "bg-red-600 text-white",
  success: "bg-emerald-600 text-white",
  ghost: "text-primary",
};

export function buttonClass(variant: keyof typeof buttonStyles = "primary", className?: string) {
  return cx(
    "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold",
    "active:scale-[0.98] transition disabled:opacity-50 disabled:pointer-events-none",
    buttonStyles[variant],
    className,
  );
}

export function Button({ variant, className, ...p }: ComponentProps<"button"> & { variant?: keyof typeof buttonStyles }) {
  return <button className={buttonClass(variant, className)} {...p} />;
}

export function LinkButton({ variant, className, ...p }: ComponentProps<typeof Link> & { variant?: keyof typeof buttonStyles }) {
  return <Link className={buttonClass(variant, className)} {...p} />;
}

export function Stat({ label, value, tone, href }: { label: string; value: ReactNode; tone?: string; href?: string }) {
  const body = (
    <>
      <div className={cx("text-3xl font-bold tabular-nums", tone)}>{value}</div>
      <div className="mt-0.5 text-sm text-muted">{label}</div>
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-2xl border border-border bg-surface p-4 active:scale-[0.98] transition">
      {body}
    </Link>
  ) : (
    <Card>{body}</Card>
  );
}
