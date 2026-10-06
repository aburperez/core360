import type { ComponentProps } from "react";
import { cx } from "./ui";

const input =
  "w-full min-h-12 rounded-xl border border-border bg-surface px-3 text-base text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary";

export function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <span className="mb-1 block text-sm font-medium">
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
    <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-500/15 dark:text-red-200">
      {message}
    </p>
  );
}
