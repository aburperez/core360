import Link from "next/link";
import { PAGE, cx } from "@/components/ui";

/**
 * O Orçamento tem as abas dos 4 valores por item e da planilha Padrão CORE
 * 360; o produtor executivo e o diretor também veem o fechamento financeiro.
 */
export function BudgetTabs({ eventId, active, financial }: { eventId: string; active: "orcamento" | "planilha" | "financeiro"; financial: boolean }) {
  const base = `/eventos/${eventId}/pre-producao`;
  const tabs: { key: string; href: string; label: string; short?: string }[] = [
    { key: "orcamento", href: `${base}/orcamento`, label: "Orçamento" },
    { key: "planilha", href: `${base}/custos`, label: "Planilha Padrão CORE 360", short: "Planilha" },
    ...(financial ? [{ key: "financeiro", href: `${base}/financeiro`, label: "Fechamento financeiro", short: "Financeiro" }] : []),
  ];
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
          {t.short ? <><span className="sm:hidden">{t.short}</span><span className="hidden sm:inline">{t.label}</span></> : t.label}
        </Link>
      ))}
    </div>
  );
}
