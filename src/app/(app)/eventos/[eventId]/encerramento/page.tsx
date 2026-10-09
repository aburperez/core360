import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUseField } from "@/server/authz/policy";
import { canCloseEvent, getClosure } from "@/modules/closure/closure.service";
import { TopBar } from "@/components/top-bar";
import { EventTabs } from "@/components/event-nav";
import { EventStages } from "@/components/event-stages";
import { PageHeading, Panel } from "@/components/panel";
import { PAGE, cx } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { EVENT_STATUS_LABEL } from "@/lib/event-stages";
import { ClosureForm, HistoryParts } from "./closure-forms";

export const metadata = { title: "Histórico e encerramento" };

const KEPT = [
  "Nome, datas, cliente e local do evento",
  "Totais do orçamento: estimado, cotado, contratado e realizado",
  "Preços dos itens: nome, categoria, quantidade, valores e fornecedor",
  "Notas dos fornecedores (continuam valendo nas próximas cotações)",
  "Quantas pessoas, chamados, fornecedores e arquivos o evento teve",
];
const ERASED = [
  "Fotos dos chamados, recebimentos, visitas e planta",
  "Documentos, orçamentos dos fornecedores e contratos",
  "Pessoas, fichas, briefings e funções",
  "Cotações, cronograma, montagem e chamados",
];

/**
 * Fase 6C (com a mudança do Abu de 2026-10-09): o evento Concluído fica
 * guardado com tudo. O diretor pode baixar uma cópia para arquivar e, se
 * quiser, encerrar e excluir (fica só o resumo). O servidor e o banco
 * conferem tudo de novo; esta tela só mostra o caminho.
 */
export default async function ClosurePage({ params }: PageProps<"/eventos/[eventId]/encerramento">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!canCloseEvent(actor, eventId)) notFound();
  const c = await getClosure(actor, eventId);
  const pre = `/eventos/${eventId}/pre-producao`;
  const concluded = c.event.status === "CONCLUIDO" && c.archive && !c.archive.closed;

  return (
    <>
      <TopBar title="Encerramento" subtitle={c.event.name} back={pre} />
      {canUseField(actor, eventId) && <EventTabs eventId={eventId} active="pre" />}
      <main className={cx(PAGE, "space-y-4 py-4 lg:py-6")}>
        <PageHeading trail={[c.event.name, "Pré-produção"]} title="Histórico e encerramento" />
        <EventStages status={c.event.status} />

        {!concluded ? (
          <Panel title="Ainda não">
            <p>
              O evento está em <b>{EVENT_STATUS_LABEL[c.event.status]}</b>. Nada é apagado: tudo continua guardado no app.
            </p>
            <p className="mt-2 text-sm text-muted">
              Quando o Fechamento terminar, mude a etapa do evento para <b>Concluído</b>. O evento continua guardado com relatórios, documentos e fotos. Aí você pode baixar uma cópia para arquivar e, se quiser, encerrar e excluir.
            </p>
            <Link href={`/eventos/${eventId}/editar`} className="mt-3 inline-block text-sm font-semibold text-primary">Mudar a etapa do evento ›</Link>
          </Panel>
        ) : (
          <>
            <section className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4">
              <p className="font-semibold text-emerald-200">O evento está guardado</p>
              <p className="text-sm text-muted">
                Concluído em {formatDateTime(c.archive!.concludedAt)}. Relatórios, documentos, fotos e contratos continuam no app. Baixar uma cópia e excluir são opcionais.
              </p>
            </section>
            <div className="gap-4 space-y-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:space-y-0">
              <Panel title="Baixar uma cópia para arquivar">
                <p className="mb-3 text-sm text-muted">
                  {c.parts.length === 1 ? "Um arquivo ZIP" : `${c.parts.length} arquivos ZIP`} com os 8 relatórios em Excel e os relatórios diários
                  {c.totals.files
                    ? `, mais os documentos, os orçamentos e as fotos (${c.totals.files} ${c.totals.files === 1 ? "arquivo" : "arquivos"}).`
                    : ". Este evento não tem fotos nem arquivos enviados."}
                </p>
                <HistoryParts eventId={eventId} parts={c.parts} />
                {c.archive!.downloadedAt && (
                  <p className="mt-3 text-sm text-emerald-300">
                    Baixado {c.archive!.downloadedBy ? `por ${c.archive!.downloadedBy} ` : ""}em {formatDateTime(c.archive!.downloadedAt)}.
                  </p>
                )}
              </Panel>
              <Panel title="Se excluir: o que fica e o que sai">
                <p className="text-sm font-semibold text-emerald-300">Fica no app (resumo)</p>
                <ul className="mt-1 space-y-1 text-sm">{KEPT.map((k) => <li key={k} className="flex gap-2"><span className="text-emerald-300">✓</span>{k}</li>)}</ul>
                <p className="mt-4 text-sm font-semibold text-red-300">Sai do app (fica só na cópia baixada)</p>
                <ul className="mt-1 space-y-1 text-sm">{ERASED.map((k) => <li key={k} className="flex gap-2"><span className="text-red-300">✕</span>{k}</li>)}</ul>
              </Panel>
            </div>
            <Panel title="Encerrar e excluir" className="border-red-500/40">
              <ClosureForm eventId={eventId} eventName={c.event.name} downloaded={!!c.archive!.downloadedAt} />
            </Panel>
          </>
        )}
      </main>
    </>
  );
}
