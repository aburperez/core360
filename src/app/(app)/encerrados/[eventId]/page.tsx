import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { getArchived } from "@/modules/closure/closure.service";
import { NotFoundError } from "@/server/errors";
import { TopBar } from "@/components/top-bar";
import { Panel } from "@/components/panel";
import { formatDateTime, formatPeriod } from "@/lib/format";
import { brl } from "@/lib/money";

export const metadata = { title: "Evento encerrado" };

/** O resumo de um evento encerrado: datas, cliente, os 4 valores e as notas dos fornecedores. */
export default async function ArchivedEventPage({ params }: PageProps<"/encerrados/[eventId]">) {
  const actor = await requireUser();
  const { eventId } = await params;
  const a = await getArchived(actor, eventId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const s = a.summary;
  const t = s.totals;
  const money: [string, number | null][] = [
    ["Orçamento aprovado", s.approved],
    ["Estimado", t.estimated],
    ["Cotado", t.quoted],
    ["Contratado", t.contracted],
    ["Realizado", t.actual],
    ["Economia", t.saving],
    ["Estouro", t.overrun],
  ];
  return (
    <>
      <TopBar title={s.name} subtitle="Evento encerrado" back="/encerrados" narrow />
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-4 lg:py-6">
        <Panel title="Evento">
          <dl className="space-y-1.5 text-sm">
            <Row label="Cliente" value={s.client} />
            <Row label="Datas" value={formatPeriod(new Date(s.startsAt), new Date(s.endsAt), s.timezone, true)} />
            {s.venue && <Row label="Local" value={s.venue} />}
            {a.agency && <Row label="Agência" value={a.agency} />}
            <Row label="Encerrado" value={`${formatDateTime(a.closedAt)}${a.closedBy ? ` por ${a.closedBy}` : ""}`} />
          </dl>
        </Panel>
        <Panel title="Valores">
          <dl className="space-y-1.5 text-sm">
            {!money.some(([, v]) => v) && <p className="text-muted">Nenhum valor lançado no orçamento.</p>}
            {money.filter(([, v]) => v).map(([k, v]) => (
              <Row key={k} label={k} value={brl(v!)} tone={k === "Estouro" && v! > 0 ? "text-red-300" : k === "Economia" && v! > 0 ? "text-emerald-300" : undefined} />
            ))}
            <Row label="Itens" value={String(t.items)} />
          </dl>
        </Panel>
        <Panel title={`Fornecedores (${s.ratings.length})`}>
          {s.ratings.length === 0 ? (
            <p className="text-sm text-muted">Nenhum fornecedor contratado.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {s.ratings.map((r) => (
                <li key={r.supplier} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 truncate">{r.supplier}</span>
                  <span className="shrink-0 tabular-nums text-muted">
                    {r.average != null ? <b className="text-amber-200">★ {r.average.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</b> : "sem nota"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="O evento teve">
          <dl className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
            {([["pessoa", "pessoas", s.counts.people], ["chamado", "chamados", s.counts.occurrences], ["fornecedor", "fornecedores", s.counts.suppliers], ["arquivo", "arquivos", s.counts.files]] as const).map(([one, many, v]) => (
              <div key={many} className="rounded-xl bg-white/5 p-3">
                <dd className="text-2xl font-bold tabular-nums">{v}</dd>
                <dt className="text-xs text-muted">{v === 1 ? one : many}</dt>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-sm text-muted">As fotos, os arquivos e os dados das pessoas foram apagados do app. Estão no histórico que a agência baixou.</p>
        </Panel>
      </main>
    </>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className={`text-right font-semibold tabular-nums ${tone ?? ""}`}>{value}</dd>
    </div>
  );
}
