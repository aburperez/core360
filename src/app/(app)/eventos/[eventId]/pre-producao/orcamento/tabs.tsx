import Link from "next/link";
import { PAGE, cx } from "@/components/ui";

/** O Orçamento tem duas abas: os 4 valores por item e a planilha Padrão CORE 360. */
export function BudgetTabs({ eventId, active }: { eventId: string; active: "orcamento" | "planilha" }) {
  const base = `/eventos/${eventId}/pre-producao`;
  const tabs = [
    { key: "orcamento", href: `${base}/orcamento`, label: "Orçamento" },
    { key: "planilha", href: `${base}/custos`, label: "Planilha Padrão CORE 360" },
  ] as const;
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
