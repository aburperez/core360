import { getEvent } from "@/modules/events/events.service";
import { listVisits } from "@/modules/visits/visits.service";
import { MIN_VISIT_PHOTOS, PLACE_FIELDS } from "@/modules/visits/report.service";
import { TopBar } from "@/components/top-bar";
import { PageHeading } from "@/components/panel";
import { LinkButton, PAGE, cx } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatDateTime } from "@/lib/format";
import { toLocalInput } from "@/lib/tz";
import { VisitActions } from "../forms";
import { VisitForm, VisitPhotos, VisitStatusButton } from "../report-forms";
import { visitWhen } from "../format";
import { loadVisitData } from "../load";

export const metadata = { title: "Visita técnica" };

/** Uma visita: quando, quem vai e EPIs; no local, o briefing do lugar e as fotos; concluir e relatório. */
export default async function VisitPage({ params }: PageProps<"/eventos/[eventId]/pre-producao/visitas/[visitId]">) {
  const { eventId, visitId } = await params;
  const { actor, visit, data } = await loadVisitData(eventId, visitId);
  const [event, list] = await Promise.all([getEvent(actor, eventId), listVisits(actor, eventId)]);
  const base = `/eventos/${eventId}/pre-producao/visitas`;
  const done = visit.status === "CONCLUIDA";
  const [date, time] = toLocalInput(visit.scheduledAt, event.timezone).split("T");

  return (
    <>
      <TopBar title={visit.title} subtitle="Visita técnica" back={base} />
      <main className={cx(PAGE, "space-y-4 py-4 lg:py-6")}>
        <PageHeading trail={[event.name, "Pré-produção", "Visitas técnicas"]} title={visit.title}>
          <LinkButton href={`${base}/${visit.id}/relatorio`} variant="secondary">
            <Icon name="report" className="h-5 w-5" /> Relatório
          </LinkButton>
        </PageHeading>

        <section className="space-y-3 rounded-2xl border border-border bg-surface p-4 lg:p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="font-semibold">{visitWhen(visit.scheduledAt, event.timezone)}</p>
              <p className="text-sm text-muted">
                Quem vai: {visit.responsible.name}
                {visit.place ? ` · ${visit.place}` : ""}
              </p>
            </div>
            {visit.canEdit && !done && (
              <VisitActions
                id={visit.id} people={list.people} onDeleted={base}
                initial={{ title: visit.title, place: visit.place, date: date!, time: time!, responsibleId: visit.responsibleId, ppe: visit.ppe, ppeOther: visit.ppeOther, notes: visit.notes }}
              />
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {visit.ppe.length === 0 && !visit.ppeOther && <span className="text-sm text-amber-300">Nenhum EPI marcado</span>}
            {visit.ppe.map((p) => <span key={p} className="rounded-full bg-amber-400/15 px-2.5 py-1 text-sm text-amber-200">{p}</span>)}
            {visit.ppeOther && <span className="rounded-full bg-white/5 px-2.5 py-1 text-sm">{visit.ppeOther}</span>}
          </div>
          {visit.notes && (
            <p className="whitespace-pre-line text-sm"><span className="font-semibold">O que verificar: </span>{visit.notes}</p>
          )}
        </section>

        <div className={cx("flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between",
          done ? "border-emerald-500/30 bg-emerald-500/10" : "border-border bg-surface")}>
          <div>
            <p className="font-semibold">{done ? "Relatório concluído" : "Relatório em aberto"}</p>
            <p className="text-sm text-muted">
              {done
                ? `Concluído em ${formatDateTime(visit.concludedAt)}. Para mudar algo, reabra.`
                : visit.canEdit
                  ? `No local, preencha o briefing do lugar e envie pelo menos ${MIN_VISIT_PHOTOS} fotos para concluir.`
                  : "Quem vai, quem marcou ou o gestor preenche o relatório."}
            </p>
          </div>
          <VisitStatusButton visit={data} min={MIN_VISIT_PHOTOS} />
        </div>
        <div className="lg:hidden">
          <LinkButton href={`${base}/${visit.id}/relatorio`} variant="secondary" className="w-full">
            <Icon name="report" className="h-5 w-5" /> Ver relatório
          </LinkButton>
        </div>

        <VisitPhotos visit={data} min={MIN_VISIT_PHOTOS} />
        <VisitForm visit={data} placeFields={PLACE_FIELDS.map((f) => ({ ...f }))} />
      </main>
    </>
  );
}
