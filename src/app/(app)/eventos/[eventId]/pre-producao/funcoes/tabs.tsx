import Link from "next/link";
import { PAGE, cx } from "@/components/ui";

/**
 * Produtores e Funções tem duas abas: a lista de produtores com a função de
 * cada um, e a planilha de quem atende cada tipo de chamado (a antiga tela
 * "Quem faz o quê").
 */
export function ProducersTabs({ eventId, active }: { eventId: string; active: "funcoes" | "quem-faz" }) {
  const base = `/eventos/${eventId}/pre-producao`;
  const tabs = [
    { key: "funcoes", href: `${base}/funcoes`, label: "Produtores e funções" },
    { key: "quem-faz", href: `${base}/quem-faz`, label: "Quem atende cada chamado" },
  ] as const;
  return (
    <div className={cx(PAGE, "flex gap-2 overflow-x-auto pt-3", "lg:in-[.protheus]:gap-0.5 lg:in-[.protheus]:border-b lg:in-[.protheus]:border-border")}>
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={cx(
            "shrink-0 rounded-full border px-4 py-2 text-sm font-semibold", "lg:in-[.protheus]:-mb-px lg:in-[.protheus]:rounded-none lg:in-[.protheus]:rounded-t-sm lg:in-[.protheus]:py-1.5 lg:in-[.protheus]:text-[13px]",
            t.key === active ? `border-primary bg-primary text-primary-foreground lg:in-[.protheus]:border-border lg:in-[.protheus]:border-b-surface lg:in-[.protheus]:bg-surface lg:in-[.protheus]:text-primary`
              : `border-border bg-surface transition hover:border-primary/60 lg:in-[.protheus]:border-transparent lg:in-[.protheus]:bg-transparent lg:in-[.protheus]:font-medium lg:in-[.protheus]:text-muted lg:in-[.protheus]:hover:text-foreground`,
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
