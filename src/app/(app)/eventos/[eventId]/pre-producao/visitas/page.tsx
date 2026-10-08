import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUsePreProduction } from "@/server/authz/policy";
import { getEvent } from "@/modules/events/events.service";
import { listVisits } from "@/modules/visits/visits.service";
import { MIN_VISIT_PHOTOS } from "@/modules/visits/report.service";
import { TopBar } from "@/components/top-bar";
import { PageHeading, Panel } from "@/components/panel";
import { MontagemPpe } from "@/components/ppe";
import { EmptyState, PAGE, cx } from "@/components/ui";
import { toLocalInput } from "@/lib/tz";
import { NewVisitForm, VisitActions } from "./forms";

export const metadata = { title: "Visitas técnicas" };

type Visit = Awaited<ReturnType<typeof listVisits>>["upcoming"][number];
type Person = Awaited<ReturnType<typeof listVisits>>["people"][number];

/**
 * Visitas técnicas da Pré-produção: quem vai, quando e com quais EPIs. Ao lado,
 * a lista básica de EPIs da montagem.
 */
export default async function VisitsPage({ params }: PageProps<"/eventos/[eventId]/pre-producao/visitas">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!canUsePreProduction(actor, eventId)) notFound();
  const [event, data] = await Promise.all([getEvent(actor, eventId), listVisits(actor, eventId)]);
  const tz = event.timezone;
  const base = `/eventos/${eventId}/pre-producao/visitas`;

  return (
    <>
      <TopBar title="Visitas técnicas" subtitle={event.name} back={`/eventos/${eventId}/pre-producao`} />
      <main className={cx(PAGE, "space-y-4 py-4 lg:py-6")}>
        <PageHeading trail={[event.name, "Pré-produção"]} title="Visitas técnicas">
          <NewVisitForm eventId={eventId} people={data.people} me={data.me} place={event.venue} />
        </PageHeading>
        <div className="lg:hidden">
          <NewVisitForm eventId={eventId} people={data.people} me={data.me} place={event.venue} />
        </div>

        <p className="text-sm text-muted">
          Quem vai ao local marca a data, o horário e os EPIs necessários. Nunca vá sozinho e avise a chegada e a saída.
          No local, abra a visita e preencha o briefing do lugar com pelo menos {MIN_VISIT_PHOTOS} fotos.
        </p>

        <div className="gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-4">
            {data.upcoming.length === 0 && data.past.length === 0 ? (
              <EmptyState title="Nenhuma visita técnica ainda">
                Marque a visita ao local com quem vai, a data, o horário e os EPIs.
              </EmptyState>
            ) : (
              <>
                {data.upcoming.length > 0 && <Group title={`Próximas (${data.upcoming.length})`} visits={data.upcoming} people={data.people} tz={tz} base={base} />}
                {data.past.length > 0 && <Group title={`Já feitas (${data.past.length})`} visits={data.past} people={data.people} tz={tz} base={base} />}
              </>
            )}
          </div>
          <aside className="mt-4 space-y-4 lg:mt-0">
            <Panel title="EPIs básicos para montagem">
              <MontagemPpe intro="Toda a equipe do campo vê esta lista no Meu briefing." />
            </Panel>
          </aside>
        </div>
      </main>
    </>
  );
}

function when(d: Date, tz: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: tz,
  }).format(d);
}

function Group({ title, visits, people, tz, base }: { title: string; visits: Visit[]; people: Person[]; tz: string; base: string }) {
  return (
    <Panel title={title}>
      <ul className="divide-y divide-border">
        {visits.map((v) => {
          const [date, time] = toLocalInput(v.scheduledAt, tz).split("T");
          return (
            <li key={v.id} className="space-y-2 py-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <Link href={`${base}/${v.id}`} className="min-w-0 transition hover:text-primary">
                  <p className="font-semibold">{v.title} ›</p>
                  <p className="text-sm text-muted">
                    {when(v.scheduledAt, tz)} · {v.responsible.name}
                    {v.place ? ` · ${v.place}` : ""}
                  </p>
                </Link>
                {v.canEdit && v.status !== "CONCLUIDA" && (
                  <VisitActions
                    id={v.id} people={people}
                    initial={{ title: v.title, place: v.place, date: date!, time: time!, responsibleId: v.responsibleId, ppe: v.ppe, ppeOther: v.ppeOther, notes: v.notes }}
                  />
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <ReportBadge status={v.status} photos={v.photos} />
                {v.ppe.length === 0 && !v.ppeOther && <span className="text-sm text-amber-300">Nenhum EPI marcado</span>}
                {v.ppe.map((p) => <span key={p} className="rounded-full bg-amber-400/15 px-2.5 py-1 text-sm text-amber-200">{p}</span>)}
                {v.ppeOther && <span className="rounded-full bg-white/5 px-2.5 py-1 text-sm">{v.ppeOther}</span>}
              </div>
              {v.notes && <p className="whitespace-pre-line text-sm text-muted">{v.notes}</p>}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** Situação do relatório da visita: concluído, ou quantas fotos já tem. */
function ReportBadge({ status, photos }: { status: string; photos: number }) {
  if (status === "CONCLUIDA") return <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-sm font-semibold text-emerald-300">Relatório concluído</span>;
  return (
    <span className={cx("rounded-full px-2.5 py-1 text-sm tabular-nums", photos ? "bg-white/10" : "bg-white/5 text-muted")}>
      Relatório: {photos} de {MIN_VISIT_PHOTOS} fotos
    </span>
  );
}
