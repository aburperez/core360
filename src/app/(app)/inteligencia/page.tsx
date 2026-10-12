import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { isAgencyAdmin } from "@/server/authz/actor";
import { resolveAgency } from "@/modules/clients/clients.service";
import { TopBar } from "@/components/top-bar";
import { PageHeading } from "@/components/panel";
import { PAGE, cx } from "@/components/ui";
import { RankingTab } from "./ranking";
import { PricesTab } from "./prices";
import { CompareTab } from "./compare";

export const metadata = { title: "Inteligência" };

const TABS = [
  { key: "ranking", label: "Ranking de fornecedores", short: "Ranking" },
  { key: "precos", label: "Banco de preços", short: "Preços" },
  { key: "comparativo", label: "Comparativo entre eventos", short: "Comparativo" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/**
 * Inteligência da agência (fase 7C): o que os eventos já ensinaram. Ranking
 * dos fornecedores pelas notas, banco de preços e comparativo entre eventos.
 * Só o diretor de produção (o Suporte só olha); o serviço e o banco conferem.
 */
export default async function IntelligencePage({ searchParams }: PageProps<"/inteligencia">) {
  const actor = await requireUser("/inteligencia");
  if (!isAgencyAdmin(actor)) notFound();
  const sp = await searchParams;
  const agency = (() => {
    try {
      return resolveAgency(actor, one(sp.agencia) ?? actor.adminAgencies[0].id);
    } catch {
      return null;
    }
  })();
  if (!agency) notFound();
  const tab: Tab = TABS.some((t) => t.key === sp.aba) ? (sp.aba as Tab) : "ranking";
  const many = actor.adminAgencies.length > 1;
  const href = (key: Tab) => `/inteligencia?${new URLSearchParams({ ...(many && { agencia: agency.id }), aba: key })}`;
  const hidden = { aba: tab, ...(many && { agencia: agency.id }) };
  const events = sp.ev === undefined ? [] : Array.isArray(sp.ev) ? sp.ev : [sp.ev];

  return (
    <>
      <TopBar title="Inteligência" subtitle={agency.name} back="/eventos?todos=1" />
      <div className={cx(PAGE, "flex gap-2 overflow-x-auto pt-3")}>
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={href(t.key)}
            aria-current={t.key === tab ? "page" : undefined}
            className={cx(
              "shrink-0 rounded-full border px-4 py-2 text-sm font-semibold",
              t.key === tab ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface transition hover:border-primary/60",
            )}
          >
            <span className="sm:hidden">{t.short}</span><span className="hidden sm:inline">{t.label}</span>
          </Link>
        ))}
      </div>
      <main className={cx(PAGE, "space-y-4 py-4 lg:py-6")}>
        <PageHeading trail={[agency.name, "Inteligência"]} title={TABS.find((t) => t.key === tab)!.label} />
        {tab === "ranking" && <RankingTab actor={actor} agencyId={agency.id} category={one(sp.categoria)} hidden={hidden} />}
        {tab === "precos" && <PricesTab actor={actor} agencyId={agency.id} q={one(sp.q)} category={one(sp.categoria)} hidden={hidden} />}
        {tab === "comparativo" && <CompareTab actor={actor} agencyId={agency.id} client={one(sp.cliente)} events={events} hidden={hidden} />}
      </main>
    </>
  );
}

