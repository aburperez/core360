import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { getServiceType } from "@/modules/service-types/service-types.service";
import { NotFoundError } from "@/server/errors";
import { TopBar } from "@/components/top-bar";
import { Card, PAGE, SectionTitle, cx } from "@/components/ui";
import { formatDateTime, formatDuration } from "@/lib/format";
import { ProposeForm, ReviewForm, TypeEditor } from "../../sla-forms";

export const metadata = { title: "Tipo de atendimento" };

const STATUS = {
  PENDENTE: { label: "Aguardando o gestor", tone: "bg-amber-400/15 text-amber-300" },
  APROVADA: { label: "Aprovada", tone: "bg-emerald-500/15 text-emerald-300" },
  AJUSTADA: { label: "Ajustada", tone: "bg-brand-cyan/15 text-brand-cyan" },
  RECUSADA: { label: "Recusada", tone: "bg-red-500/15 text-red-300" },
} as const;

const dur = (m: number | null) => (m ? formatDuration(m * 60) : "—");

export default async function ServiceTypePage({ params }: PageProps<"/eventos/[eventId]/pre-producao/tipos/[typeId]">) {
  const actor = await requireUser();
  const { eventId, typeId } = await params;
  const t = await getServiceType(actor, typeId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  if (t.eventId !== eventId) notFound();
  const base = `/eventos/${eventId}/pre-producao`;
  const pending = t.proposals.find((p) => p.status === "PENDENTE");

  return (
    <>
      <TopBar title={t.name} subtitle={`${t.team.area.name} › ${t.team.name}`} back={`${base}/tipos`} />
      <main className={cx(PAGE, "py-4 lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start lg:gap-8 lg:py-6")}>
        <div>
          <Card>
            <p className="text-sm text-muted">SLA deste tipo</p>
            <p className="mt-1 text-4xl font-bold tabular-nums">{dur(t.slaMinutes)}</p>
            <p className="mt-1 text-sm text-muted">
              {t.slaMinutes ? "É o prazo de todo chamado aberto com este tipo." : "Sem SLA aprovado: o chamado usa o prazo da prioridade."}
            </p>
            {t.description && <p className="mt-4 whitespace-pre-wrap">{t.description}</p>}
            {t.can.manage && (
              <div className="mt-4 border-t border-border pt-3">
                <TypeEditor typeId={t.id} name={t.name} description={t.description} backHref={base} />
              </div>
            )}
          </Card>

          {pending && (
            <>
              <SectionTitle>Proposta aguardando</SectionTitle>
              <Card className="border-amber-400/40">
                <p>
                  <strong>{pending.proposedBy.id === actor.userId ? "Você" : pending.proposedBy.name}</strong> propôs{" "}
                  <strong className="text-lg">{dur(pending.minutes)}</strong>
                </p>
                {pending.note && <p className="mt-1 text-sm text-muted">&ldquo;{pending.note}&rdquo;</p>}
                <p className="mt-1 text-xs text-muted">{formatDateTime(pending.createdAt)}</p>
                {t.can.review ? (
                  <div className="mt-4"><ReviewForm proposalId={pending.id} proposed={pending.minutes} /></div>
                ) : (
                  <p className="mt-3 text-sm text-muted">O gerente vai aprovar, ajustar ou recusar com um comentário.</p>
                )}
              </Card>
            </>
          )}

          {!pending && (
            <>
              <SectionTitle>{t.can.review ? "SLA" : "Propor SLA"}</SectionTitle>
              <Card><ProposeForm typeId={t.id} manager={t.can.review} current={t.slaMinutes} /></Card>
            </>
          )}

          <SectionTitle action={<Link href={`${base}/quem-faz?equipe=${t.teamId}`} className="text-sm font-semibold text-primary">Editar</Link>}>
            Quem faz
          </SectionTitle>
          {t.people.length === 0 ? (
            <p className="px-1 text-sm text-muted">Ninguém marcado ainda.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {t.people.map((p) => (
                <span key={p.id} className="rounded-full border border-border bg-surface px-3 py-1.5 text-sm">
                  {p.name}{p.jobTitle ? <span className="text-muted"> · {p.jobTitle}</span> : null}
                </span>
              ))}
            </div>
          )}
        </div>

        <aside className="lg:sticky lg:top-24 lg:[&>:first-child]:mt-0">
          <SectionTitle>Histórico do SLA</SectionTitle>
          {t.proposals.length === 0 ? (
            <p className="px-1 text-sm text-muted">Nenhuma proposta ainda.</p>
          ) : (
            <ol className="space-y-3">
              {t.proposals.map((p) => {
                const self = p.reviewedBy?.id === p.proposedBy.id;
                return (
                  <li key={p.id}>
                    <Card className="text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <p>
                          <strong>{p.proposedBy.name}</strong> {self ? "definiu" : "propôs"} <strong>{dur(p.minutes)}</strong>
                        </p>
                        {!self && <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", STATUS[p.status].tone)}>{STATUS[p.status].label}</span>}
                      </div>
                      {p.note && <p className="mt-1 text-muted">&ldquo;{p.note}&rdquo;</p>}
                      <p className="mt-1 text-xs text-muted">{formatDateTime(p.createdAt)}</p>
                      {p.reviewedBy && !self && (
                        <div className="mt-3 border-l-2 border-primary pl-3">
                          <p>
                            <strong>{p.reviewedBy.name}</strong>{" "}
                            {p.status === "APROVADA" ? "aprovou" : p.status === "AJUSTADA" ? <>ajustou para <strong>{dur(p.approvedMinutes)}</strong></> : "recusou"}
                          </p>
                          {p.feedback && <p className="mt-1 text-muted">&ldquo;{p.feedback}&rdquo;</p>}
                          <p className="mt-1 text-xs text-muted">{formatDateTime(p.reviewedAt)}</p>
                        </div>
                      )}
                    </Card>
                  </li>
                );
              })}
            </ol>
          )}
        </aside>
      </main>
    </>
  );
}
