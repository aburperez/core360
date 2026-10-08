import { canReviewSla } from "@/server/authz/policy";
import { TopBar } from "@/components/top-bar";
import { PageHeading } from "@/components/panel";
import { LinkButton, PAGE, cx } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatDateTime } from "@/lib/format";
import { EventBriefingForm } from "./briefing-form";
import { loadEventBriefing } from "./load";

export const metadata = { title: "Briefing do evento" };

/** Briefing do evento: o que o cliente pediu, com as 13 frentes de estrutura e o relatório em PDF. */
export default async function EventBriefingPage({ params }: PageProps<"/eventos/[eventId]/pre-producao/briefing-evento">) {
  const { eventId } = await params;
  const { actor, event, briefing, ficha } = await loadEventBriefing(eventId);
  const base = `/eventos/${eventId}/pre-producao`;
  const p = briefing.progress;
  const text = Object.fromEntries(Object.entries(briefing).filter(([, v]) => typeof v === "string" || v === null)) as Record<string, string | null>;

  return (
    <>
      <TopBar title="Briefing do evento" subtitle={event.name} back={base} />
      <main className={cx(PAGE, "space-y-4 py-4 lg:py-6")}>
        <PageHeading trail={[event.name, "Pré-produção"]} title="Briefing do evento">
          <LinkButton href={`${base}/briefing-evento/relatorio`} variant="secondary">
            <Icon name="report" className="h-5 w-5" /> Relatório
          </LinkButton>
        </PageHeading>

        <div className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">
              {p.answered} de 13 frentes respondidas · {p.needed} {p.needed === 1 ? "precisa" : "precisam"}
            </p>
            <p className="text-sm text-muted">
              {p.filled} de {p.fields} campos preenchidos
              {briefing.updatedAt ? ` · atualizado em ${formatDateTime(briefing.updatedAt)}` : " · ainda não preenchido"}
            </p>
          </div>
          <LinkButton href={`${base}/briefing-evento/relatorio`} variant="secondary" className="lg:hidden">
            <Icon name="report" className="h-5 w-5" /> Ver relatório
          </LinkButton>
        </div>

        <section className="rounded-2xl border border-border bg-surface p-4 lg:p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-semibold">Da ficha do evento</h2>
            {canReviewSla(actor, eventId) && (
              <a href={`/eventos/${eventId}/editar`} className="text-sm font-medium text-primary">Editar ficha ›</a>
            )}
          </div>
          <p className="text-sm text-muted">Nome, tipo, datas, público e local ficam na ficha, num lugar só.</p>
          <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            {ficha.map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="w-32 shrink-0 text-muted">{k}</dt>
                <dd className="min-w-0">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <EventBriefingForm eventId={eventId} initial={{ text, fronts: briefing.fronts }} />
      </main>
    </>
  );
}
