import { TopBar } from "@/components/top-bar";
import { formatDateTime } from "@/lib/format";
import { BRIEFING_BLOCKS } from "@/lib/event-briefing";
import { PrintButton } from "@/components/print-button";
import { loadEventBriefing } from "../load";

export const metadata = { title: "Briefing do evento" };

const NEED_LABEL = (v: boolean | null) => (v === true ? "Precisa" : v === false ? "Não precisa" : "A definir");
const NEED_STYLE = (v: boolean | null) =>
  v === true ? "bg-[#043246] text-white" : v === false ? "bg-slate-200 text-slate-600" : "bg-amber-100 text-amber-800";

/**
 * Briefing do evento para imprimir ou salvar em PDF: uma folha branca, igual
 * na tela e no papel, com a ficha, os três blocos e as 13 frentes.
 */
export default async function EventBriefingReportPage({ params }: PageProps<"/eventos/[eventId]/pre-producao/briefing-evento/relatorio">) {
  const { eventId } = await params;
  const { event, briefing, ficha } = await loadEventBriefing(eventId);
  const b = briefing as unknown as Record<string, string | null>;

  return (
    <>
      <TopBar title="Relatório" subtitle="Briefing do evento" back={`/eventos/${eventId}/pre-producao/briefing-evento`} />
      <main className="mx-auto w-full max-w-4xl px-4 py-4 lg:px-8 lg:py-6 print:max-w-none print:p-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <p className="text-sm text-muted">Para PDF, toque em Salvar em PDF e escolha &quot;Salvar como PDF&quot; na impressora.</p>
          <PrintButton />
        </div>

        <article className="rounded-2xl bg-white p-6 text-slate-900 shadow-xl sm:p-10 print:rounded-none print:p-0 print:shadow-none">
          <header className="flex items-start justify-between gap-4 border-b-2 border-[#043246] pb-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-[#043246]">Briefing do evento</p>
              <h1 className="mt-1 text-2xl font-bold">{event.name}</h1>
            </div>
            <p className="shrink-0 text-right text-xs text-slate-500">
              CORE 360
              <br />
              {briefing.updatedAt ? `Atualizado em ${formatDateTime(briefing.updatedAt)}` : "Não preenchido"}
            </p>
          </header>

          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 print:grid-cols-2">
            {ficha.map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="w-32 shrink-0 font-semibold text-slate-500">{k}</dt>
                <dd className="min-w-0">{v}</dd>
              </div>
            ))}
          </dl>

          {BRIEFING_BLOCKS.map((blk) => (
            <section key={blk.title}>
              <h2 className="mt-6 border-b border-slate-300 pb-1 text-lg font-bold text-[#043246]">{blk.title}</h2>
              <div className="mt-2 space-y-2">
                {blk.fields.map((f) => (
                  <div key={f.key} className="break-inside-avoid text-sm">
                    <h3 className="font-bold">{f.label}</h3>
                    <p className={b[f.key] ? "whitespace-pre-line leading-relaxed" : "text-slate-400"}>{b[f.key] ?? "Não informado"}</p>
                  </div>
                ))}
              </div>
            </section>
          ))}

          <h2 className="mt-6 border-b border-slate-300 pb-1 text-lg font-bold text-[#043246]">
            Estrutura ({briefing.progress.needed} de 13 frentes precisam)
          </h2>
          <table className="mt-2 w-full text-sm">
            <tbody>
              {briefing.fronts.map((f) => (
                <tr key={f.key} className="break-inside-avoid border-b border-slate-200 align-top">
                  <td className="w-36 py-1.5 pr-3 font-semibold">{f.label}</td>
                  <td className="w-28 py-1.5 pr-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${NEED_STYLE(f.needed)}`}>{NEED_LABEL(f.needed)}</span>
                  </td>
                  <td className="whitespace-pre-line py-1.5">{f.notes ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      </main>
    </>
  );
}
