import type { ComponentProps } from "react";
import { cx } from "./ui";

const input = cx(
  "w-full min-h-12 rounded-xl border border-border bg-surface px-3 text-base text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary",
  // No computador, dentro do evento (moldura Protheus): campos baixos e retos, como no ERP.
  "lg:in-[.protheus]:min-h-8 lg:in-[.protheus]:rounded-sm lg:in-[.protheus]:bg-background lg:in-[.protheus]:px-2 lg:in-[.protheus]:text-[13px] lg:in-[.protheus]:focus:ring-1",
);

export function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <span className="mb-1 block text-sm font-medium lg:in-[.protheus]:text-xs lg:in-[.protheus]:text-muted">
      {children}
      {hint && <span className="ml-1 font-normal text-muted">{hint}</span>}
    </span>
  );
}

export function Input({ className, ...p }: ComponentProps<"input">) {
  return <input className={cx(input, className)} {...p} />;
}

export function Select({ className, ...p }: ComponentProps<"select">) {
  return <select className={cx(input, "appearance-none", className)} {...p} />;
}

export function Textarea({ className, ...p }: ComponentProps<"textarea">) {
  return <textarea className={cx(input, "min-h-24 py-2", className)} {...p} />;
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-xl px-3 py-2 text-sm bg-red-500/15 text-red-200">
      {message}
    </p>
  );
}
