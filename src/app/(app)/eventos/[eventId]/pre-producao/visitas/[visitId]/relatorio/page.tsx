import { getEvent } from "@/modules/events/events.service";
import { PLACE_FIELDS } from "@/modules/visits/report.service";
import { TopBar } from "@/components/top-bar";
import { ROLE_LABEL, formatDateTime } from "@/lib/format";
import { visitWhen } from "../../format";
import { loadVisitData } from "../../load";
import { PrintButton } from "./print-button";

export const metadata = { title: "Relatório da visita técnica" };

/**
 * Relatório da visita para imprimir ou salvar em PDF: uma folha branca, igual
 * na tela e no papel, com quem foi, os EPIs, o briefing do lugar e as fotos.
 */
export default async function VisitReportPage({ params }: PageProps<"/eventos/[eventId]/pre-producao/visitas/[visitId]/relatorio">) {
  const { eventId, visitId } = await params;
  const { actor, visit } = await loadVisitData(eventId, visitId);
  const event = await getEvent(actor, eventId);
  const filled = PLACE_FIELDS.filter((f) => visit[f.key]);
  const ppe = [...visit.ppe, ...(visit.ppeOther ? [visit.ppeOther] : [])];
  const facts = [
    ["Evento", event.name],
    ["Cliente", event.client.name],
    ["Data e horário", visitWhen(visit.scheduledAt, event.timezone)],
    ["Quem foi", `${visit.responsible.name} (${ROLE_LABEL[visit.responsible.role]})${visit.people ? `, ${visit.people}` : ""}`],
    ["Local", visit.place ?? event.venue ?? "—"],
    ["Endereço", visit.address ?? event.address ?? "—"],
    ["EPIs", ppe.length ? ppe.join(", ") : "—"],
  ];

  return (
    <>
      <TopBar title="Relatório" subtitle={visit.title} back={`/eventos/${eventId}/pre-producao/visitas/${visit.id}`} />
      <main className="mx-auto w-full max-w-4xl px-4 py-4 lg:px-8 lg:py-6 print:max-w-none print:p-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <p className="text-sm text-muted">
            {visit.status === "CONCLUIDA" ? "Relatório concluído." : "Em aberto: o relatório ainda pode mudar."} Para PDF, toque em Salvar em PDF e
            escolha &quot;Salvar como PDF&quot; na impressora.
          </p>
          <PrintButton />
        </div>

        <article className="rounded-2xl bg-white p-6 text-slate-900 shadow-xl sm:p-10 print:rounded-none print:p-0 print:shadow-none">
          <header className="flex items-start justify-between gap-4 border-b-2 border-[#043246] pb-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-[#043246]">Relatório de visita técnica</p>
              <h1 className="mt-1 text-2xl font-bold">{visit.title}</h1>
            </div>
            <p className="shrink-0 text-right text-xs text-slate-500">
              CORE 360
              <br />
              {visit.status === "CONCLUIDA" ? `Concluído em ${formatDateTime(visit.concludedAt)}` : "Em aberto"}
            </p>
          </header>

          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 print:grid-cols-2">
            {facts.map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="w-28 shrink-0 font-semibold text-slate-500">{k}</dt>
                <dd className="min-w-0 whitespace-pre-line">{v}</dd>
              </div>
            ))}
          </dl>

          {visit.notes && (
            <>
              <h2 className="mt-6 border-b border-slate-300 pb-1 text-lg font-bold text-[#043246]">O que verificar</h2>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{visit.notes}</p>
            </>
          )}

          <h2 className="mt-6 border-b border-slate-300 pb-1 text-lg font-bold text-[#043246]">Briefing do lugar</h2>
          {filled.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Nada preenchido ainda.</p>
          ) : (
            <div className="mt-2 space-y-3">
              {filled.map((f) => (
                <section key={f.key} className="break-inside-avoid">
                  <h3 className="text-sm font-bold">{f.label}</h3>
                  <p className="whitespace-pre-line text-sm leading-relaxed">{visit[f.key]}</p>
                </section>
              ))}
            </div>
          )}

          <h2 className="mt-6 border-b border-slate-300 pb-1 text-lg font-bold text-[#043246]">Fotos ({visit.photos.length})</h2>
          {visit.photos.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Nenhuma foto.</p>
          ) : (
            <ul className="mt-3 grid grid-cols-2 gap-4 print:grid-cols-3 print:gap-3">
              {visit.photos.map((p, i) => (
                <li key={p.id} className="break-inside-avoid">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/visit-photos/${p.id}`} alt={p.caption || `Foto ${i + 1}`} className="aspect-[4/3] w-full rounded object-cover" />
                  <p className="mt-1 text-xs">
                    <b>{i + 1}.</b> {p.caption || <span className="text-slate-500">Sem legenda</span>}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </article>
      </main>
    </>
  );
}
