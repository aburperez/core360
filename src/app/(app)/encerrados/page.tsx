import Link from "next/link";
import { requireUser } from "@/server/http/session";
import { listArchived } from "@/modules/closure/closure.service";
import { TopBar } from "@/components/top-bar";
import { EmptyState } from "@/components/ui";
import { formatDate, formatPeriod } from "@/lib/format";
import { brl } from "@/lib/money";

export const metadata = { title: "Eventos encerrados" };

/** O que ficou de cada evento encerrado: só o resumo (fase 6C). O banco decide quem vê. */
export default async function ArchivedPage() {
  const actor = await requireUser("/encerrados");
  const rows = await listArchived(actor);
  const many = new Set(rows.map((r) => r.agency)).size > 1;
  return (
    <>
      <TopBar title="Eventos encerrados" subtitle={actor.name} back="/eventos?todos=1" narrow />
      <main className="mx-auto max-w-2xl space-y-3 px-4 py-4 lg:py-6">
        <p className="text-sm text-muted">
          Eventos que já tiveram o histórico baixado e foram encerrados. As fotos, os arquivos e as pessoas foram apagados; fica o resumo.
        </p>
        {rows.length === 0 ? (
          <EmptyState title="Nenhum evento encerrado">Quando um evento concluído for encerrado, o resumo dele aparece aqui.</EmptyState>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.eventId}>
                <Link href={`/encerrados/${r.eventId}`} className="block rounded-2xl border border-border bg-surface p-4 transition hover:border-primary/60">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-lg font-semibold">{r.summary.name}</p>
                      <p className="truncate text-sm text-muted">{r.summary.client}{many ? ` · ${r.agency}` : ""}</p>
                      <p className="mt-1 text-sm text-muted">{formatPeriod(new Date(r.summary.startsAt), new Date(r.summary.endsAt), r.summary.timezone, true)}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      {r.summary.totals.actual > 0 && <p className="font-semibold tabular-nums">{brl(r.summary.totals.actual)}</p>}
                      <p className="mt-1 text-xs text-muted">Encerrado em {formatDate(r.closedAt)}</p>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
