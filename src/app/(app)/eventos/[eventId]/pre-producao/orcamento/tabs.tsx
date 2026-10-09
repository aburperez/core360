import Link from "next/link";
import { PAGE, cx } from "@/components/ui";

/**
 * O Orçamento tem as abas dos 4 valores por item e da planilha Padrão CORE
 * 360; o produtor executivo e o diretor também veem o fechamento financeiro.
 */
export function BudgetTabs({ eventId, active, financial }: { eventId: string; active: "orcamento" | "planilha" | "financeiro"; financial: boolean }) {
  const base = `/eventos/${eventId}/pre-producao`;
  const tabs = [
    { key: "orcamento", href: `${base}/orcamento`, label: "Orçamento" },
    { key: "planilha", href: `${base}/custos`, label: "Planilha Padrão CORE 360" },
    ...(financial ? [{ key: "financeiro", href: `${base}/financeiro`, label: "Fechamento financeiro" }] : []),
  ];
  return (
    <div className={cx(PAGE, "flex gap-2 overflow-x-auto pt-3")}>
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={cx(
            "shrink-0 rounded-full border px-4 py-2 text-sm font-semibold",
            t.key === active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface transition hover:border-primary/60",
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
