import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canManageAreas, canReviewSla, canUseField, canUsePreProduction } from "@/server/authz/policy";
import { getEvent } from "@/modules/events/events.service";
import { getFunctionsPanel } from "@/modules/functions/functions.service";
import { TopBar } from "@/components/top-bar";
import { EventTabs } from "@/components/event-nav";
import { BriefingPill } from "@/components/briefing-view";
import { Card, EmptyState, PAGE, SectionTitle, cx } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/format";
import { DefaultsPicker, FunctionSelect, NewFunctionForm } from "./forms";
import { SheetPanel } from "./sheet";
import { ProducersTabs } from "./tabs";

export const metadata = { title: "Produtores e Funções" };

type Panel = Awaited<ReturnType<typeof getFunctionsPanel>>;
type Person = Panel["people"][number];

/**
 * Produtores e Funções: as funções do evento e todos os produtores numa tela,
 * com função, agenda, ficha e briefing de cada um. A lista de funções vem da
 * planilha pronta ou da lista padrão (click and build); função fora da lista é
 * só do diretor de produção.
 */
export default async function FunctionsPanelPage({ params }: PageProps<"/eventos/[eventId]/pre-producao/funcoes">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!canUsePreProduction(actor, eventId)) notFound();
  const [event, panel] = await Promise.all([getEvent(actor, eventId), getFunctionsPanel(actor, eventId)]);
  const director = canReviewSla(actor, eventId);
  const base = `/eventos/${eventId}/pre-producao`;
  const options = panel.functions.map((f) => ({ id: f.id, name: f.name }));
  const names = new Map(options.map((f) => [f.id, f.name]));

  // Gestão do evento primeiro, depois cada área e equipe.
  const groups = new Map<string, { label: string; teamId: string | null; people: Person[] }>();
  for (const p of panel.people) {
    const key = p.role === "GERENTE" ? "0" : p.team ? `2${p.area?.name}${p.team.name}` : `1${p.area?.name ?? ""}`;
    const label = p.role === "GERENTE" ? "Gestão do evento" : p.team ? `${p.area?.name} › ${p.team.name}` : `${p.area?.name ?? "Sem área"} (Heads)`;
    if (!groups.has(key)) groups.set(key, { label, teamId: p.role === "GERENTE" ? null : (p.team?.id ?? null), people: [] });
    groups.get(key)!.people.push(p);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR")).map(([, g]) => g);
  const people = panel.people;
  const stats = [
    { label: "produtores", value: people.length },
    { label: "com função", value: people.filter((p) => p.functionId).length },
    { label: "com briefing", value: people.filter((p) => p.briefingState !== "SEM").length },
    { label: "já leram", value: people.filter((p) => p.briefingState === "LIDO").length, tone: "text-emerald-300" },
  ];

  return (
    <>
      <TopBar title="Produtores e Funções" subtitle={event.name} />
      {canUseField(actor, eventId) && <EventTabs eventId={eventId} active="pre" />}
      <ProducersTabs eventId={eventId} active="funcoes" />
      <main className={cx(PAGE, "py-4 lg:py-6")}>
        <p className="mb-4 px-1 text-sm text-muted">
          Monte a lista de funções de duas formas: envie a planilha pronta ou escolha da lista padrão. Depois dê a
          função a cada produtor. Mais de um produtor pode ter a mesma função. Cada um vê a função, a agenda e o
          briefing em &ldquo;Meu briefing&rdquo;, marca o que já fez e preenche a própria ficha.
        </p>

        <div className="mb-4"><SheetPanel eventId={eventId} canEditAreas={canManageAreas(actor, eventId)} /></div>

        <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {stats.map((s) => (
            <Card key={s.label} className="py-3">
              <p className={cx("text-2xl font-bold tabular-nums", s.tone)}>{s.value}</p>
              <p className="text-sm text-muted">{s.label}</p>
            </Card>
          ))}
        </div>

        <SectionTitle>Funções ({panel.functions.length})</SectionTitle>
        {panel.functions.length === 0 && panel.defaults.length > 0 ? (
          <Card>
            <p className="font-semibold">Monte a lista com um clique</p>
            <p className="mt-1 text-sm text-muted">
              Marque as funções que este evento vai ter. Depois dá para mudar o nome, apagar ou acrescentar outras.
            </p>
            <DefaultsPicker eventId={eventId} names={panel.defaults} />
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {panel.functions.map((f) => (
              <Link
                key={f.id}
                href={`${base}/funcoes/${f.id}`}
                className="block rounded-2xl border border-border bg-surface px-4 py-3 transition hover:border-primary/60 active:scale-[0.99]"
              >
                <p className="truncate font-semibold">{f.name}</p>
                <p className="text-sm text-muted">
                  {f.peopleCount} {f.peopleCount === 1 ? "produtor" : "produtores"} · {f.activityCount} {f.activityCount === 1 ? "atividade" : "atividades"}
                </p>
              </Link>
            ))}
          </div>
        )}
        <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="lg:w-96">
            {director ? (
              <NewFunctionForm eventId={eventId} />
            ) : (
              <p className="text-sm text-muted">Função fora da lista padrão: só o diretor de produção cria.</p>
            )}
          </div>
          {panel.functions.length > 0 && panel.defaults.length > 0 && (
            <div className="lg:max-w-xl"><DefaultsPicker eventId={eventId} names={panel.defaults} compact /></div>
          )}
        </div>

        <SectionTitle>Produtores</SectionTitle>
        {people.length === 0 ? (
          <EmptyState title="Nenhum produtor ainda">Monte as equipes primeiro em Montar equipe.</EmptyState>
        ) : (
          <div className="space-y-4">
            {ordered.map((g) => (
              <Card key={g.label} className="p-0">
                <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{g.label}</h2>
                  {g.teamId && (
                    <Link href={`${base}/briefing/equipe/${g.teamId}`} className="shrink-0 text-sm font-semibold text-primary">
                      Briefing da equipe
                    </Link>
                  )}
                </div>

                {/* Computador: planilha. */}
                <table className="hidden w-full table-fixed text-left text-sm lg:table">
                  <thead className="text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-4 py-2 font-semibold">Produtor</th>
                      <th className="w-72 px-4 py-2 font-semibold">Função</th>
                      <th className="w-40 px-4 py-2 font-semibold">Agenda</th>
                      <th className="w-36 px-4 py-2 font-semibold">Ficha</th>
                      <th className="w-44 px-4 py-2 text-right font-semibold">Briefing</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border border-t border-border">
                    {g.people.map((p) => (
                      <tr key={p.id} className="transition hover:bg-white/5">
                        <td className="px-4 py-2.5">
                          <Link href={`${base}/funcoes/pessoa/${p.id}`} className="font-semibold hover:text-primary">{p.name}</Link>
                          <p className="text-xs text-muted">{p.jobTitle ?? ROLE_LABEL[p.role]}{p.phone ? ` · ${p.phone}` : ""}</p>
                        </td>
                        <td className="px-4 py-2.5">
                          <FunctionSelect eventId={eventId} participantId={p.id} value={p.functionId} functions={options} />
                        </td>
                        <td className="px-4 py-2.5 tabular-nums"><AgendaCell a={p.activities} /></td>
                        <td className="px-4 py-2.5 tabular-nums"><ProfileCell n={p.profileFilled} /></td>
                        <td className="px-4 py-2.5 text-right">
                          <Link href={`${base}/briefing/${p.id}`} aria-label={`Briefing de ${p.name}`}><BriefingPill state={p.briefingState} /></Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Celular: cartões. */}
                <ul className="divide-y divide-border lg:hidden">
                  {g.people.map((p) => (
                    <li key={p.id} className="space-y-2 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <Link href={`${base}/funcoes/pessoa/${p.id}`} className="min-w-0">
                          <span className="block font-semibold">{p.name} <span aria-hidden className="text-primary">›</span></span>
                          <span className="block truncate text-sm text-muted">
                            {p.functionId ? names.get(p.functionId) : (p.jobTitle ?? ROLE_LABEL[p.role])}
                          </span>
                        </Link>
                        <Link href={`${base}/briefing/${p.id}`} aria-label={`Briefing de ${p.name}`}><BriefingPill state={p.briefingState} /></Link>
                      </div>
                      <FunctionSelect eventId={eventId} participantId={p.id} value={p.functionId} functions={options} />
                      <p className="flex gap-4 text-sm"><AgendaCell a={p.activities} /><ProfileCell n={p.profileFilled} /></p>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

function AgendaCell({ a }: { a: { total: number; done: number } }) {
  if (a.total === 0) return <span className="text-muted">Sem atividades</span>;
  return (
    <span className={a.done === a.total ? "text-emerald-300" : ""}>
      {a.done}/{a.total} <span className="text-muted">feitas</span>
    </span>
  );
}

function ProfileCell({ n }: { n: number }) {
  if (n === 0) return <span className="text-muted">Ficha vazia</span>;
  return <span className={n === 5 ? "text-emerald-300" : ""}>Ficha {n}/5</span>;
}
