import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { getOccurrence } from "@/modules/occurrences/occurrences.service";
import { listParticipants } from "@/modules/participants/participants.service";
import { markOccurrenceRead } from "@/modules/notifications/notifications.service";
import { NotFoundError } from "@/server/errors";
import { TopBar } from "@/components/top-bar";
import { Card, PAGE, PriorityText, SectionTitle, SlaPill, StatusBadge, cx } from "@/components/ui";
import { formatDateTime, formatDuration, STATUS_LABEL } from "@/lib/format";
import { OccurrenceActions } from "./occurrence-actions";

export const metadata = { title: "Ocorrência" };

const ACTION_LABEL: Record<string, string> = {
  CREATE: "Abriu o chamado",
  STATUS_CHANGE: "Mudou o status",
  CONCLUDE: "Concluiu",
  CANCEL: "Cancelou",
  REASSIGN: "Reatribuiu",
  TEAM_CHANGE: "Mudou de equipe",
  VALIDATE: "Validação do gestor",
  UPDATE: "Atualizou",
};

export default async function OccurrencePage({ params }: PageProps<"/eventos/[eventId]/ocorrencias/[occurrenceId]">) {
  const actor = await requireUser();
  const { eventId, occurrenceId } = await params;
  const o = await getOccurrence(actor, occurrenceId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  if (o.eventId !== eventId) notFound();
  // Abrir o chamado responde aos avisos dele (e para os lembretes do urgente).
  await markOccurrenceRead(actor, occurrenceId);

  const people = o.can.manage ? await listParticipants(actor, eventId, { areaId: o.areaId }) : [];
  const names = new Map<string, string>([
    ...people.filter((p) => p.userId).map((p) => [p.userId!, p.name] as [string, string]),
    ...(o.createdBy ? [[o.createdBy.id, o.createdBy.name] as [string, string]] : []),
    ...(o.concludedBy ? [[o.concludedBy.id, o.concludedBy.name] as [string, string]] : []),
    [actor.userId, "Você"],
  ]);
  const closed = o.status === "CONCLUIDO" || o.status === "CANCELADO";

  return (
    <>
      <TopBar title={`#${o.number} ${o.title}`} subtitle={`${o.area.name} › ${o.team.name}`} back={`/eventos/${eventId}/ocorrencias`} />
      {/* Computador: ficha, ações e fotos à esquerda; histórico ao lado. */}
      <main className={cx(PAGE, "py-4 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-8 lg:py-6")}>
        <div>
          <Card>
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={o.status} />
              <PriorityText priority={o.priority} />
              <SlaPill dueAt={o.slaDueAt} closed={closed} />
              {o.type === "TAREFA" && <span className="text-xs text-muted">Tarefa</span>}
            </div>
            {o.description && <p className="mt-3 whitespace-pre-wrap">{o.description}</p>}
            {o.process && <p className="mt-2 text-sm text-muted">Processo: {o.process}</p>}
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Info label="Responsável" value={o.responsible?.name ?? "Equipe"} />
              <Info label="Aberto por" value={o.createdBy?.name ?? "—"} />
              <Info label="Abertura" value={formatDateTime(o.openedAt)} />
              <Info label="Prazo (SLA)" value={formatDateTime(o.slaDueAt)} />
              {o.concludedAt && <Info label="Conclusão" value={formatDateTime(o.concludedAt)} />}
              {o.concludedAt && (
                <Info
                  label="Duração"
                  value={<>{formatDuration(o.durationSeconds)} {o.slaBreached ? <span className="text-red-400">· fora do SLA</span> : <span className="text-emerald-300">· no prazo</span>}</>}
                />
              )}
              {o.validationStatus !== "PENDENTE" && (
                <Info label="Validação" value={`${o.validationStatus === "APROVADA" ? "Aprovada" : "Reprovada"} por ${o.validatedBy?.name ?? "—"}`} />
              )}
            </dl>
          </Card>

          <OccurrenceActions
            occurrence={{ id: o.id, status: o.status, version: o.version, responsibleParticipantId: o.responsibleParticipantId, priority: o.priority }}
            can={o.can}
            people={people.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, teamName: p.team?.name ?? null }))}
          />

          <SectionTitle>Evidências ({o.attachments.length})</SectionTitle>
          {o.attachments.length === 0 ? (
            <p className="px-1 text-sm text-muted">Nenhuma foto ainda.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {o.attachments.map((a) => (
                <a key={a.id} href={`/api/attachments/${a.id}`} target="_blank" rel="noopener" className="relative block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/attachments/${a.id}`} alt="Evidência" loading="lazy" className="aspect-square w-full rounded-xl object-cover bg-border" />
                  {a.kind === "CONCLUSAO" && (
                    <span className="absolute bottom-1 left-1 rounded bg-emerald-600 px-1.5 text-[10px] font-semibold text-white">Solução</span>
                  )}
                </a>
              ))}
            </div>
          )}
        </div>

        <aside className="lg:sticky lg:top-24 lg:[&>:first-child]:mt-0">
          <SectionTitle>Histórico</SectionTitle>
          <Card>
            <ol className="space-y-3">
              {o.history.map((h) => {
                const after = (h.after ?? {}) as Record<string, unknown>;
                const detail =
                  typeof after.status === "string" ? `→ ${STATUS_LABEL[after.status as keyof typeof STATUS_LABEL] ?? after.status}`
                  : after.attachmentAdded ? "Anexou uma foto"
                  : "";
                return (
                  <li key={h.id} className="flex gap-3 text-sm">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    <div>
                      <p>
                        <strong>{names.get(h.actorUserId ?? "") ?? "Equipe"}</strong> · {ACTION_LABEL[h.action] ?? h.action} {detail}
                      </p>
                      <p className="text-xs text-muted">{formatDateTime(h.occurredAt)}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>
        </aside>
      </main>
    </>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
