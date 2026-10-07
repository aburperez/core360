"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { getPlanBoard } from "@/modules/floorplans/floorplans.service";
import { pointSituation, type PointSituation } from "@/modules/floorplans/situation";
import { formatDateTime } from "@/lib/format";
import { toLocalInput } from "@/lib/tz";
import { api } from "@/components/api-client";
import { Button, Card, cx } from "@/components/ui";
import { FormError, Input, Label, Select, Textarea } from "@/components/field";
import { Icon } from "@/components/icons";
import { PlanViewer, type Pin, type ViewerHandle } from "./viewer";
import { isPdf, pdfPageCount, preparePlan } from "./prepare";

type Board = Awaited<ReturnType<typeof getPlanBoard>>;
type Point = Board["points"][number];

export const SITUATION: Record<PointSituation, { label: string; color: string; tone: string }> = {
  NAO_INICIADO: { label: "Não iniciada", color: "#94a3b8", tone: "bg-slate-400/15 text-slate-300" },
  EM_ANDAMENTO: { label: "Em andamento", color: "#3b82f6", tone: "bg-blue-500/15 text-blue-300" },
  CONCLUIDO: { label: "Concluída", color: "#22c55e", tone: "bg-emerald-500/15 text-emerald-300" },
  ATRASADO: { label: "Atrasada", color: "#ef4444", tone: "bg-red-500/15 text-red-300" },
};
const KIND = { MONTAGEM: "Montagem", FINALIZACAO: "Finalização" } as const;
const SIT_FILTERS: { key: PointSituation | "ALL"; label: string }[] = [
  { key: "ALL", label: "Todas" },
  { key: "ATRASADO", label: "Atrasadas" },
  { key: "EM_ANDAMENTO", label: "Em andamento" },
  { key: "NAO_INICIADO", label: "Não iniciadas" },
  { key: "CONCLUIDO", label: "Concluídas" },
];

type Mode =
  | { kind: "list" }
  | { kind: "view"; id: string }
  | { kind: "place" }
  | { kind: "new"; x: number; y: number }
  | { kind: "edit"; id: string; x: number; y: number; moving: boolean }
  | { kind: "upload" };

/** Hora atual, que anda sozinha (para "atrasada" mudar sem recarregar). */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function PlanBoard({ board, eventId }: { board: Board; eventId: string }) {
  const router = useRouter();
  const now = useNow();
  const viewer = useRef<ViewerHandle>(null);
  const [mode, setMode] = useState<Mode>(board.plans.length ? { kind: "list" } : { kind: board.canManagePlans ? "upload" : "list" });
  const [sit, setSit] = useState<PointSituation | "ALL">("ALL");
  const [kind, setKind] = useState<"ALL" | "MONTAGEM" | "FINALIZACAO">("ALL");
  const [area, setArea] = useState("ALL");
  const [team, setTeam] = useState("ALL");

  const numbered = useMemo(
    () => board.points.map((p, i) => ({ ...p, n: i + 1, situation: pointSituation(p, now) })),
    [board.points, now],
  );
  const areas = uniq(numbered.filter((p) => p.areaId && p.areaName).map((p) => [p.areaId!, p.areaName!]));
  const teams = uniq(numbered.filter((p) => p.teamId && p.teamName && (area === "ALL" || p.areaId === area)).map((p) => [p.teamId!, p.teamName!]));
  const shown = numbered.filter(
    (p) =>
      (sit === "ALL" || p.situation === sit)
      && (kind === "ALL" || p.kind === kind)
      && (area === "ALL" || p.areaId === area)
      && (team === "ALL" || p.teamId === team),
  );
  const count = (k: PointSituation | "ALL") => (k === "ALL" ? numbered.length : numbered.filter((p) => p.situation === k).length);

  const selectedId = mode.kind === "view" || mode.kind === "edit" ? mode.id : null;
  const selected = numbered.find((p) => p.id === selectedId) ?? null;
  const draft = mode.kind === "new" ? { x: mode.x, y: mode.y } : mode.kind === "edit" && (mode.x !== selected?.x || mode.y !== selected?.y) ? { x: mode.x, y: mode.y } : null;
  const placing = mode.kind === "place" || (mode.kind === "edit" && mode.moving);

  const pins: Pin[] = shown
    .filter((p) => !(mode.kind === "edit" && p.id === mode.id && draft))
    .map((p) => ({ id: p.id, x: p.x, y: p.y, n: p.n, color: SITUATION[p.situation].color, square: p.kind === "FINALIZACAO", label: `${p.n}. ${p.name}` }));

  const select = (id: string) => {
    const p = numbered.find((q) => q.id === id);
    if (!p) return;
    setMode({ kind: "view", id });
    viewer.current?.focus(p.x, p.y);
  };
  const onTap = (x: number, y: number) => {
    if (mode.kind === "place") setMode({ kind: "new", x, y });
    else if (mode.kind === "edit" && mode.moving) setMode({ ...mode, x, y, moving: false });
    else if (mode.kind === "view") setMode({ kind: "list" });
  };
  const done = () => {
    setMode({ kind: "list" });
    router.refresh();
  };

  const plan = board.plan;
  const sheet = (() => {
    switch (mode.kind) {
      case "upload":
        return <UploadForm eventId={eventId} first={false} onClose={() => setMode({ kind: "list" })} />;
      case "new":
        return <PointForm board={board} key={`new-${mode.x}-${mode.y}`} at={{ x: mode.x, y: mode.y }} onDone={done} onCancel={() => setMode({ kind: "list" })} />;
      case "edit":
        return selected ? (
          <PointForm
            board={board}
            key={`edit-${selected.id}`}
            point={selected}
            at={{ x: mode.x, y: mode.y }}
            moving={mode.moving}
            onMove={() => setMode({ ...mode, moving: true })}
            onDone={done}
            onCancel={() => setMode({ kind: "view", id: selected.id })}
          />
        ) : null;
      case "view":
        return selected ? (
          <PointDetail
            key={selected.id + selected.status}
            p={selected}
            onEdit={() => setMode({ kind: "edit", id: selected.id, x: selected.x, y: selected.y, moving: false })}
            onClose={() => setMode({ kind: "list" })}
            onChanged={() => router.refresh()}
          />
        ) : null;
      default:
        return null;
    }
  })();

  if (!plan) {
    return (
      <div className="max-w-lg">
        {mode.kind === "upload" ? (
          <Card><UploadForm eventId={eventId} first /></Card>
        ) : (
          <Card className="text-center">
            <Icon name="map" className="mx-auto h-10 w-10 text-muted" />
            <p className="mt-2 font-semibold">A planta ainda não foi enviada</p>
            <p className="mt-1 text-sm text-muted">Quando o gerente enviar, ela aparece aqui com as etapas de montagem e de finalização.</p>
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className="gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0">
        {/* Plantas do evento (abas) e ações do gerente. */}
        {(board.plans.length > 1 || board.canManagePlans) && (
          <div className="mb-3 flex items-center gap-2 overflow-x-auto pb-1">
            {board.plans.map((p) => (
              <Link
                key={p.id}
                href={`?p=${p.id}`}
                scroll={false}
                aria-current={p.id === plan.id ? "page" : undefined}
                className={cx(
                  "min-h-10 shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition",
                  p.id === plan.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface hover:border-primary/60",
                )}
              >
                {p.name}
              </Link>
            ))}
            {board.canManagePlans && (
              <button
                type="button"
                onClick={() => setMode({ kind: "upload" })}
                className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border border-dashed border-border px-4 text-sm font-semibold text-primary hover:border-primary/60"
              >
                <Icon name="plus" className="h-4 w-4" /> Planta
              </button>
            )}
          </div>
        )}

        {board.canMark && (
          <div className="mb-3 flex items-center gap-2">
            {placing ? (
              <p className="flex min-h-12 flex-1 items-center gap-2 rounded-xl bg-accent/15 px-3 text-sm font-semibold text-accent">
                <Icon name="pin" className="h-5 w-5 shrink-0" />
                Toque na planta onde fica a etapa
              </p>
            ) : (
              <Button type="button" onClick={() => setMode({ kind: "place" })} className="flex-1 lg:flex-none">
                <Icon name="pin" className="h-5 w-5" /> Marcar etapa
              </Button>
            )}
            {placing && (
              <Button type="button" variant="secondary" onClick={() => setMode(mode.kind === "edit" ? { ...mode, moving: false } : { kind: "list" })}>
                Cancelar
              </Button>
            )}
          </div>
        )}

        <PlanViewer
          ref={viewer}
          src={`/api/floor-plans/${plan.id}/image?v=${plan.sha256.slice(0, 12)}`}
          pins={pins}
          selectedId={selectedId}
          draft={draft}
          placing={placing}
          onTap={onTap}
          onSelect={select}
        />
        <Legend />
      </div>

      <aside className="mt-4 flex flex-col gap-4 lg:mt-0">
        {sheet && (
          <div
            className={cx(
              "fixed inset-x-0 bottom-0 z-40 max-h-[64vh] overflow-y-auto rounded-t-3xl border-t border-border bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-[0_-10px_40px_rgba(0,0,0,0.5)]",
              "lg:static lg:z-auto lg:max-h-none lg:rounded-2xl lg:border lg:pb-4 lg:shadow-none",
            )}
          >
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-white/20 lg:hidden" />
            {sheet}
          </div>
        )}

        <section>
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Etapas</h2>
            <span className="text-sm text-muted">
              {numbered.filter((p) => p.situation === "CONCLUIDO").length} de {numbered.length} concluídas
            </span>
          </div>
          {numbered.length > 0 && (
            <div className="mb-3 space-y-2">
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:px-0">
                {SIT_FILTERS.map((f) => (
                  <Chip key={f.key} on={sit === f.key} onClick={() => setSit(f.key)} dot={f.key === "ALL" ? undefined : SITUATION[f.key].color}>
                    {f.label} <span className="tabular-nums opacity-70">{count(f.key)}</span>
                  </Chip>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Select aria-label="Tipo" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="min-h-10 px-2 text-sm">
                  <option value="ALL">Tipo</option>
                  <option value="MONTAGEM">Montagem</option>
                  <option value="FINALIZACAO">Finalização</option>
                </Select>
                <Select aria-label="Área" value={area} onChange={(e) => { setArea(e.target.value); setTeam("ALL"); }} className="min-h-10 px-2 text-sm" disabled={areas.length === 0}>
                  <option value="ALL">Área</option>
                  {areas.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </Select>
                <Select aria-label="Equipe" value={team} onChange={(e) => setTeam(e.target.value)} className="min-h-10 px-2 text-sm" disabled={teams.length === 0}>
                  <option value="ALL">Equipe</option>
                  {teams.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </Select>
              </div>
            </div>
          )}
          {numbered.length === 0 ? (
            <Card className="text-sm text-muted">
              Nenhuma etapa marcada ainda.{board.canMark && " Toque em “Marcar etapa” e depois no lugar da planta."}
            </Card>
          ) : shown.length === 0 ? (
            <p className="px-1 text-sm text-muted">Nenhuma etapa com esses filtros.</p>
          ) : (
            <ul className="space-y-2">
              {[...shown].sort(bySituation).map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => select(p.id)}
                    className={cx(
                      "flex w-full items-center gap-3 rounded-2xl border bg-surface p-3 text-left transition hover:border-primary/60",
                      p.id === selectedId ? "border-primary" : "border-border",
                    )}
                  >
                    <span
                      className={cx("flex h-9 w-9 shrink-0 items-center justify-center text-sm font-bold text-white", p.kind === "FINALIZACAO" ? "rounded-lg" : "rounded-full")}
                      style={{ background: SITUATION[p.situation].color }}
                    >
                      {p.n}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{p.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {[KIND[p.kind], p.teamName ?? p.areaName, p.endsAt ? `até ${formatDateTime(p.endsAt)}` : p.startsAt ? `às ${formatDateTime(p.startsAt)}` : null].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", SITUATION[p.situation].tone)}>{SITUATION[p.situation].label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {board.canManagePlans && <PlanAdmin plan={plan} onUpload={() => setMode({ kind: "upload" })} />}
        </section>
      </aside>
    </div>
  );
}

const ORDER: Record<PointSituation, number> = { ATRASADO: 0, EM_ANDAMENTO: 1, NAO_INICIADO: 2, CONCLUIDO: 3 };
const bySituation = (a: { situation: PointSituation; n: number }, b: { situation: PointSituation; n: number }) =>
  ORDER[a.situation] - ORDER[b.situation] || a.n - b.n;

function uniq(pairs: [string, string][]) {
  return [...new Map(pairs).entries()].sort((a, b) => a[1].localeCompare(b[1]));
}

function Chip({ on, onClick, dot, children }: { on: boolean; onClick: () => void; dot?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        "flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition",
        on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface hover:border-primary/60",
      )}
    >
      {dot && <span className="h-2.5 w-2.5 rounded-full" style={{ background: dot }} />}
      {children}
    </button>
  );
}

function Legend() {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-muted">
      {(Object.keys(SITUATION) as PointSituation[]).map((k) => (
        <span key={k} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: SITUATION[k].color }} /> {SITUATION[k].label}
        </span>
      ))}
      <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-2 border-muted" /> Montagem</span>
      <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-[3px] border-2 border-muted" /> Finalização</span>
    </div>
  );
}

// ─────────────────────────── Detalhe da etapa ───────────────────────────

function PointDetail({ p, onEdit, onClose, onChanged }: { p: Point & { n: number; situation: PointSituation }; onEdit: () => void; onClose: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [note, setNote] = useState(p.note ?? "");
  const [photo, setPhoto] = useState<File | null>(null);
  const s = SITUATION[p.situation];

  const setStatus = async (status: "NAO_INICIADO" | "EM_ANDAMENTO" | "CONCLUIDO", withNote?: string) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/plan-points/${p.id}/status`, { body: { status, note: withNote } });
      if (photo) {
        const form = new FormData();
        form.set("file", photo);
        await api(`/api/plan-points/${p.id}/photos`, { body: form });
      }
      setFinishing(false);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex items-start gap-3">
        <span
          className={cx("flex h-10 w-10 shrink-0 items-center justify-center font-bold text-white", p.kind === "FINALIZACAO" ? "rounded-lg" : "rounded-full")}
          style={{ background: s.color }}
        >
          {p.n}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold leading-snug">{p.name}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm">
            <span className={cx("rounded-full px-2 py-0.5 text-xs font-semibold", s.tone)}>{s.label}</span>
            <span className="text-muted">{KIND[p.kind]}</span>
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar" className="-mr-2 -mt-1 flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:bg-white/5">
          <Icon name="close" className="h-5 w-5" />
        </button>
      </div>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
        <Row label="Área">{p.areaName ?? (p.areaId ? "Outra área" : "Geral")}</Row>
        {p.teamId && <Row label="Equipe">{p.teamName ?? "Outra equipe"}</Row>}
        {p.responsibleId && <Row label="Responsável">{p.responsibleName ?? "Outra equipe"}</Row>}
        {(p.startsAt || p.endsAt) && (
          <Row label="Previsto">{[p.startsAt && formatDateTime(p.startsAt), p.endsAt && formatDateTime(p.endsAt)].filter(Boolean).join(" até ")}</Row>
        )}
        {p.startedAt && <Row label="Começou">{formatDateTime(p.startedAt)}</Row>}
        {p.finishedAt && <Row label="Concluiu">{formatDateTime(p.finishedAt)}</Row>}
      </dl>
      {p.description && <p className="mt-3 whitespace-pre-line text-sm">{p.description}</p>}
      {p.note && <p className="mt-2 text-sm text-muted">&ldquo;{p.note}&rdquo;</p>}
      {p.photoIds.length > 0 && (
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {p.photoIds.map((id, k) => (
            <a key={id} href={`/api/plan-point-photos/${id}`} target="_blank" rel="noreferrer" className="shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/plan-point-photos/${id}`} alt={`Foto ${k + 1}`} className="h-20 w-20 rounded-lg object-cover" />
            </a>
          ))}
        </div>
      )}

      <FormError message={error} />

      {p.canWork && finishing && (
        <form
          className="mt-4 space-y-3 border-t border-border pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void setStatus("CONCLUIDO", note);
          }}
        >
          <label className="block">
            <Label hint="(opcional)">Observação</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Ex.: palco montado e liberado" />
          </label>
          <label className="block">
            <Label hint="(opcional)">Foto</Label>
            <FilePick accept="image/*" capture="environment" label="📷 Tirar foto" file={photo} onPick={setPhoto} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" onClick={() => setFinishing(false)} disabled={busy}>Voltar</Button>
            <Button type="submit" variant="success" disabled={busy}>{busy ? "Salvando…" : "Concluir"}</Button>
          </div>
        </form>
      )}

      {!finishing && (
        <div className="mt-4 space-y-2">
          {p.canWork && p.status === "NAO_INICIADO" && (
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" onClick={() => setStatus("EM_ANDAMENTO")} disabled={busy}>Iniciar</Button>
              <Button type="button" variant="success" onClick={() => setFinishing(true)} disabled={busy}>Concluir</Button>
            </div>
          )}
          {p.canWork && p.status === "EM_ANDAMENTO" && (
            <Button type="button" variant="success" className="w-full" onClick={() => setFinishing(true)} disabled={busy}>Concluir etapa</Button>
          )}
          {p.canWork && p.status === "CONCLUIDO" && (
            <Button type="button" variant="secondary" className="w-full" onClick={() => setStatus("EM_ANDAMENTO")} disabled={busy}>Reabrir</Button>
          )}
          <div className="flex gap-2">
            {p.canWork && p.status === "EM_ANDAMENTO" && (
              <Button type="button" variant="ghost" className="flex-1" onClick={() => setStatus("NAO_INICIADO")} disabled={busy}>Desfazer início</Button>
            )}
            {p.canEdit && (
              <Button type="button" variant="secondary" className="flex-1" onClick={onEdit} disabled={busy}>
                <Icon name="edit" className="h-4 w-4" /> Editar
              </Button>
            )}
          </div>
          {!p.canWork && <p className="text-center text-xs text-muted">Quem marca esta etapa é a equipe dela, o head da área ou o gerente.</p>}
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

// ─────────────────────────── Marcar e editar ───────────────────────────

function PointForm({
  board, point, at, moving, onMove, onDone, onCancel,
}: {
  board: Board; point?: Point; at: { x: number; y: number }; moving?: boolean; onMove?: () => void; onDone: () => void; onCancel: () => void;
}) {
  const tz = board.timeZone;
  const opts = board.options ?? { areas: [], teams: [], people: [] };
  const [kind, setKind] = useState<"MONTAGEM" | "FINALIZACAO">(point?.kind ?? "MONTAGEM");
  const [areaId, setAreaId] = useState(point?.areaId ?? board.lockedAreaId ?? "");
  const [teamId, setTeamId] = useState(point?.teamId ?? "");
  const [responsibleId, setResponsibleId] = useState(point?.responsibleId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const teams = opts.teams.filter((t) => !areaId || t.areaId === areaId);
  const people = opts.people.filter((p) => (teamId ? p.teamId === teamId || p.role !== "OPERACIONAL" : !areaId || p.areaId === areaId || p.role === "GERENTE"));

  const submit = async (form: FormData) => {
    setBusy(true);
    setError(null);
    const body = {
      name: form.get("name"),
      description: form.get("description") || null,
      kind,
      x: at.x,
      y: at.y,
      areaId: areaId || null,
      teamId: teamId || null,
      responsibleId: responsibleId || null,
      startsAt: form.get("startsAt") || null,
      endsAt: form.get("endsAt") || null,
    };
    try {
      if (point) await api(`/api/plan-points/${point.id}`, { method: "PATCH", body });
      else await api(`/api/floor-plans/${board.plan!.id}/points`, { body });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api(`/api/plan-points/${point!.id}`, { method: "DELETE" });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(new FormData(e.currentTarget));
      }}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{point ? "Editar etapa" : "Nova etapa"}</h2>
        <button type="button" onClick={onCancel} aria-label="Fechar" className="-mr-2 flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:bg-white/5">
          <Icon name="close" className="h-5 w-5" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo">
        {(["MONTAGEM", "FINALIZACAO"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            className={cx(
              "flex min-h-12 items-center justify-center gap-2 rounded-xl border font-semibold transition",
              kind === k ? "border-primary bg-primary/15 text-primary" : "border-border bg-background/40 text-muted",
            )}
          >
            <span className={cx("h-3.5 w-3.5 border-2 border-current", k === "MONTAGEM" ? "rounded-full" : "rounded-[3px]")} />
            {KIND[k]}
          </button>
        ))}
      </div>

      <label className="block">
        <Label>Nome da etapa</Label>
        <Input name="name" required maxLength={120} defaultValue={point?.name} placeholder="Ex.: Montagem do palco principal" autoFocus={!point} />
      </label>

      {board.lockedAreaId ? (
        <p className="text-sm"><span className="text-muted">Área:</span> {opts.areas[0]?.name}</p>
      ) : (
        <label className="block">
          <Label>Área</Label>
          <Select value={areaId} onChange={(e) => { setAreaId(e.target.value); setTeamId(""); }}>
            <option value="">Geral (sem área)</option>
            {opts.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </label>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <Label>Equipe</Label>
          <Select value={teamId} onChange={(e) => setTeamId(e.target.value)} disabled={!areaId}>
            <option value="">{areaId ? "Toda a área" : "Escolha a área"}</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </label>
        <label className="block">
          <Label>Responsável</Label>
          <Select value={responsibleId} onChange={(e) => setResponsibleId(e.target.value)}>
            <option value="">Ninguém</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <Label>Início previsto</Label>
          <Input type="datetime-local" name="startsAt" defaultValue={point?.startsAt ? toLocalInput(point.startsAt, tz) : ""} />
        </label>
        <label className="block">
          <Label>Fim previsto</Label>
          <Input type="datetime-local" name="endsAt" defaultValue={point?.endsAt ? toLocalInput(point.endsAt, tz) : ""} />
        </label>
      </div>
      <label className="block">
        <Label hint="(opcional)">Detalhes</Label>
        <Textarea name="description" maxLength={1000} defaultValue={point?.description ?? ""} placeholder="O que precisa estar pronto, acesso, observações" />
      </label>

      {point && onMove && (
        <Button type="button" variant="secondary" className="w-full" onClick={onMove} disabled={moving}>
          <Icon name="pin" className="h-5 w-5" /> {moving ? "Toque no novo lugar da planta" : "Mudar de lugar na planta"}
        </Button>
      )}

      <FormError message={error} />
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>Cancelar</Button>
        <Button type="submit" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</Button>
      </div>
      {point && (
        confirmDelete ? (
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" onClick={() => setConfirmDelete(false)} disabled={busy}>Não apagar</Button>
            <Button type="button" variant="danger" onClick={remove} disabled={busy}>Apagar mesmo</Button>
          </div>
        ) : (
          <Button type="button" variant="ghost" className="w-full text-red-300" onClick={() => setConfirmDelete(true)} disabled={busy}>Apagar etapa</Button>
        )
      )}
    </form>
  );
}

// ─────────────────────────── Plantas (gerente) ───────────────────────────

function UploadForm({ eventId, first, onClose }: { eventId: string; first: boolean; onClose?: () => void }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState(0);
  const [step, setStep] = useState<"" | "preparando" | "enviando">("");
  const [error, setError] = useState<string | null>(null);

  const pick = async (f: File | null) => {
    setFile(f);
    setPages(0);
    setError(null);
    if (f && isPdf(f)) setPages(await pdfPageCount(f).catch(() => 0));
  };

  const submit = async (form: FormData) => {
    if (!file) return setError("Escolha o arquivo da planta");
    setError(null);
    try {
      setStep("preparando");
      const image = await preparePlan(file, Number(form.get("page") ?? 1));
      setStep("enviando");
      const body = new FormData();
      body.set("data", JSON.stringify({ name: form.get("name") }));
      body.set("file", image, "planta.jpg");
      const saved = await api<{ id: string }>(`/api/events/${eventId}/floor-plans`, { body });
      router.push(`/eventos/${eventId}/planta?p=${saved.id}`, { scroll: false });
      router.refresh();
      onClose?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStep("");
    }
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(new FormData(e.currentTarget));
      }}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{first ? "Enviar a planta do evento" : "Nova planta"}</h2>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Fechar" className="-mr-2 flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:bg-white/5">
            <Icon name="close" className="h-5 w-5" />
          </button>
        )}
      </div>
      <p className="text-sm text-muted">PDF ou imagem (JPG, PNG). Pode enviar mais de uma: geral, palco, backstage.</p>
      <label className="block">
        <Label>Nome</Label>
        <Input name="name" required maxLength={80} defaultValue={first ? "Planta geral" : ""} placeholder="Ex.: Palco principal" />
      </label>
      <label className="block">
        <Label>Arquivo</Label>
        <FilePick accept="application/pdf,image/*" label="Escolher arquivo" file={file} onPick={(f) => void pick(f)} />
      </label>
      {pages > 1 && (
        <label className="block">
          <Label hint={`(o PDF tem ${pages})`}>Página da planta</Label>
          <Input type="number" name="page" min={1} max={pages} defaultValue={1} inputMode="numeric" />
        </label>
      )}
      <FormError message={error} />
      <Button type="submit" className="w-full" disabled={!!step}>
        <Icon name="upload" className="h-5 w-5" />
        {step === "preparando" ? "Preparando a planta…" : step === "enviando" ? "Enviando…" : "Enviar planta"}
      </Button>
    </form>
  );
}

/** Campo de arquivo com o texto em português (o do navegador vem no idioma do aparelho). */
function FilePick({ accept, capture, label, file, onPick }: { accept: string; capture?: "environment"; label: string; file: File | null; onPick: (f: File | null) => void }) {
  return (
    <span className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border bg-background/40 px-2 transition hover:border-primary/60">
      <span className="shrink-0 rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold">{label}</span>
      <span className="min-w-0 truncate text-sm text-muted">{file?.name ?? "Nenhum arquivo escolhido"}</span>
      <input type="file" accept={accept} capture={capture} className="sr-only" onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
    </span>
  );
}

function PlanAdmin({ plan, onUpload }: { plan: NonNullable<Board["plan"]>; onUpload: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<"" | "rename" | "delete">("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, after: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setMode("");
      after();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="mt-4 rounded-2xl border border-border bg-surface p-3 text-sm">
      <summary className="cursor-pointer font-semibold text-muted">Planta “{plan.name}”</summary>
      <div className="mt-3 space-y-2">
        {mode === "rename" ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const name = new FormData(e.currentTarget).get("name");
              void run(() => api(`/api/floor-plans/${plan.id}`, { method: "PATCH", body: { name } }), () => router.refresh());
            }}
          >
            <Input name="name" defaultValue={plan.name} maxLength={80} required className="flex-1" />
            <Button type="submit" disabled={busy}>Salvar</Button>
          </form>
        ) : mode === "delete" ? (
          <div className="space-y-2">
            <p>Apagar a planta e {plan.points === 1 ? "a etapa marcada" : `as ${plan.points} etapas marcadas`} nela?</p>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="secondary" onClick={() => setMode("")} disabled={busy}>Não</Button>
              <Button
                type="button"
                variant="danger"
                disabled={busy}
                onClick={() => run(() => api(`/api/floor-plans/${plan.id}`, { method: "DELETE" }), () => { router.replace("?", { scroll: false }); router.refresh(); })}
              >
                Apagar
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <Button type="button" variant="secondary" className="min-h-10 px-2 text-sm" onClick={() => setMode("rename")}>Renomear</Button>
            <Button type="button" variant="secondary" className="min-h-10 px-2 text-sm" onClick={onUpload}>Outra planta</Button>
            <Button type="button" variant="secondary" className="min-h-10 px-2 text-sm text-red-300" onClick={() => setMode("delete")}>Apagar</Button>
          </div>
        )}
        <FormError message={error} />
      </div>
    </details>
  );
}
