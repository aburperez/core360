import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUseField, canUsePreProduction } from "@/server/authz/policy";
import { getEvent } from "@/modules/events/events.service";
import { REPORT_KEYS, REPORTS } from "@/modules/reports/catalog";
import { canOpenReport } from "@/modules/reports/build.service";
import { TopBar } from "@/components/top-bar";
import { EventTabs } from "@/components/event-nav";
import { Icon } from "@/components/icons";
import { PageHeading } from "@/components/panel";
import { PAGE, cx } from "@/components/ui";

export const metadata = { title: "Relatórios" };

/**
 * Relatórios da fase 6B: cada um abre como folha para salvar em PDF ou sai
 * em Excel. O financeiro e o executivo só aparecem para o diretor.
 */
export default async function ReportsPage({ params }: PageProps<"/eventos/[eventId]/pre-producao/relatorios">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!canUsePreProduction(actor, eventId)) notFound();
  const event = await getEvent(actor, eventId);
  const base = `/eventos/${eventId}/pre-producao`;
  const keys = REPORT_KEYS.filter((k) => canOpenReport(actor, eventId, k));

  return (
    <>
      <TopBar title="Relatórios" subtitle={event.name} back={base} />
      {canUseField(actor, eventId) && <EventTabs eventId={eventId} active="pre" />}
      <main className={cx(PAGE, "space-y-4 py-4 lg:py-6")}>
        <PageHeading trail={[event.name, "Pré-produção"]} title="Relatórios" />
        <p className="text-sm text-muted">Abra para ver e salvar em PDF, ou baixe direto em Excel. Os números saem na hora, do que está no app.</p>

        <ul className="grid gap-3 lg:grid-cols-2">
          {keys.map((k) => {
            const r = REPORTS[k];
            return (
              <li key={k} className="flex flex-col rounded-2xl border border-border bg-surface p-4">
                <div className="flex items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-cyan/15 text-brand-cyan">
                    <Icon name="report" className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="font-bold">
                      {r.title}
                      {r.director && <span className="ml-2 rounded-full bg-violet-500/20 px-2 py-0.5 text-xs font-semibold text-violet-200">Só o diretor</span>}
                    </h2>
                    <p className="mt-0.5 text-sm text-muted">{r.description}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 pl-14">
                  <Link href={`${base}/relatorios/${k}`} className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:opacity-90">
                    Abrir e salvar PDF
                  </Link>
                  <a href={`/api/events/${eventId}/reports/${k}`} className="inline-flex min-h-11 items-center rounded-xl border border-border px-4 text-sm font-semibold transition hover:border-primary/60">
                    Baixar Excel
                  </a>
                </div>
              </li>
            );
          })}
          <li className="flex flex-col rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/10 text-muted">
                <Icon name="report" className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="font-bold">Relatório diário</h2>
                <p className="mt-0.5 text-sm text-muted">Chamados e recebimentos de cada dia, com as observações do gestor.</p>
              </div>
            </div>
            <div className="mt-3 pl-14">
              <Link href={`${base}/relatorio`} className="inline-flex min-h-11 items-center rounded-xl border border-border px-4 text-sm font-semibold transition hover:border-primary/60">
                Abrir
              </Link>
            </div>
          </li>
        </ul>
      </main>
    </>
  );
}
