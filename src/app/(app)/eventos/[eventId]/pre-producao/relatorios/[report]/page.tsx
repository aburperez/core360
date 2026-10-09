import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { NotFoundError } from "@/server/errors";
import { isReportKey, REPORTS, type Block, type Cell, type Column } from "@/modules/reports/catalog";
import { buildReport } from "@/modules/reports/build.service";
import { brl, decimal } from "@/lib/money";
import { TopBar } from "@/components/top-bar";
import { PrintButton } from "@/components/print-button";

export async function generateMetadata({ params }: PageProps<"/eventos/[eventId]/pre-producao/relatorios/[report]">) {
  const { report } = await params;
  return { title: isReportKey(report) ? REPORTS[report].title : "Relatório" };
}

/**
 * Um relatório como folha branca, igual na tela e no papel: a pessoa salva em
 * PDF pela impressão do navegador ou baixa o mesmo conteúdo em Excel.
 */
export default async function ReportSheetPage({ params }: PageProps<"/eventos/[eventId]/pre-producao/relatorios/[report]">) {
  const actor = await requireUser();
  const { eventId, report } = await params;
  if (!isReportKey(report)) notFound();
  const r = await buildReport(actor, eventId, report).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const wide = r.blocks.some((b) => b.kind === "table" && b.columns.length > 8);

  return (
    <>
      <TopBar title={r.title} subtitle={r.eventName} back={`/eventos/${eventId}/pre-producao/relatorios`} />
      <main className={`mx-auto w-full px-4 py-4 lg:px-8 lg:py-6 print:max-w-none print:p-0 ${wide ? "max-w-7xl" : "max-w-5xl"}`}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <p className="text-sm text-muted">Para PDF, toque em Salvar em PDF e escolha &quot;Salvar como PDF&quot;.{wide && " Tabelas largas saem melhor com o papel deitado."}</p>
          <div className="flex gap-2">
            <a href={`/api/events/${eventId}/reports/${report}`} className="inline-flex min-h-11 items-center rounded-xl border border-border bg-surface px-4 text-sm font-semibold transition hover:border-primary/60">
              Baixar Excel
            </a>
            <PrintButton />
          </div>
        </div>

        <article className="rounded-2xl bg-white p-5 text-slate-900 shadow-xl sm:p-8 print:rounded-none print:p-0 print:shadow-none">
          <header className="flex flex-col gap-2 border-b-2 border-[#043246] pb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4 print:flex-row print:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold uppercase tracking-wide text-[#043246]">{r.title}</p>
              <h1 className="mt-1 text-2xl font-bold">{r.eventName}</h1>
            </div>
            <p className="shrink-0 text-xs text-slate-500 sm:text-right print:text-right">
              CORE 360
              <br />
              {r.generated}
              {r.values && (
                <>
                  <br />
                  <span className="font-semibold text-[#043246]">Confidencial: tem valores</span>
                </>
              )}
            </p>
          </header>
          {r.blocks.map((b, i) => <BlockView key={i} b={b} />)}
        </article>
      </main>
    </>
  );
}

function BlockView({ b }: { b: Block }) {
  const title = <h2 className="mt-6 break-after-avoid border-b border-slate-300 pb-1 text-lg font-bold text-[#043246]">{b.title}</h2>;
  if (b.kind === "facts") {
    return (
      <section className="break-inside-avoid">
        {title}
        <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2 print:grid-cols-2">
          {b.rows.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="w-40 shrink-0 font-semibold text-slate-500">{k}</dt>
              <dd className="min-w-0">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    );
  }
  if (b.kind === "text") {
    return (
      <section>
        {title}
        <div className="mt-2 space-y-2">
          {b.rows.map(([k, v]) => (
            <div key={k} className="break-inside-avoid text-sm">
              <h3 className="font-bold">{k}</h3>
              <p className="whitespace-pre-line leading-relaxed">{v}</p>
            </div>
          ))}
        </div>
      </section>
    );
  }
  return (
    <section>
      {title}
      {b.rows.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">{b.empty}</p>
      ) : (
        <div className="-mx-5 mt-2 overflow-x-auto px-5 sm:-mx-8 sm:px-8 print:mx-0 print:overflow-visible print:px-0">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b-2 border-slate-300 text-slate-500">
                {b.columns.map((c) => (
                  <th key={c.header} className={`whitespace-nowrap px-1.5 py-1.5 font-semibold ${right(c) ? "text-right" : ""}`}>{c.header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, i) => (
                <tr key={i} className="break-inside-avoid border-b border-slate-200 align-top">
                  {row.map((v, j) => (
                    <td key={j} className={`px-1.5 py-1.5 ${right(b.columns[j]!) ? "whitespace-nowrap text-right tabular-nums" : ""} ${j === 0 ? "font-semibold" : ""} ${b.columns[j]!.header === "Código" ? "whitespace-nowrap" : ""}`}>
                      {show(v, b.columns[j]!)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {b.note && <p className="mt-2 text-xs text-slate-500">{b.note}</p>}
    </section>
  );
}

const right = (c: Column) => !!(c.money || c.number);

function show(v: Cell, c: Column) {
  if (v === null || v === "") return c.money ? "—" : "";
  if (typeof v === "number") return c.money ? brl(v) : decimal(v);
  return v;
}
