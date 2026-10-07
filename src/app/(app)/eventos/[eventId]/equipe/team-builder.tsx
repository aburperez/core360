"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, SectionTitle, cx } from "@/components/ui";
import { FormError, Input, Label, Select, Textarea } from "@/components/field";
import { api } from "@/components/api-client";
import { ROLE_LABEL } from "@/lib/format";

type Role = "GERENTE" | "HEAD" | "OPERACIONAL" | "CLIENTE" | "PRE_PRODUTOR";
const EVENT_LEVEL: Role[] = ["GERENTE", "CLIENTE", "PRE_PRODUTOR"];
type Area = { id: string; name: string; canAddTeam: boolean; roles: Role[] };
type ClientView = { costs: boolean; team: boolean; progress: boolean };
type Team = { id: string; name: string; areaId: string };
type Person = {
  id: string; name: string; email: string; phone: string | null; jobTitle: string | null; role: Role;
  areaId: string | null; teamId: string | null; active: boolean; joined: boolean; invited: boolean; mine: boolean;
  /** Quem vê a tela pode dar função a esta pessoa? */
  canGiveFunction: boolean;
};
type Fn = { id: string; name: string };
/** Funções do evento e a de cada pessoa, para quem dá função (Pré-produção e Head). */
type FunctionChoices = { functions: Fn[]; assigned: Record<string, string> } | null;

export function TeamBuilder(props: {
  eventId: string;
  myUserId: string;
  canAddArea: boolean;
  areas: Area[];
  eventRoles: Role[];
  teams: Team[];
  people: Person[];
  canGrantClientView: boolean;
  clientViews: Record<string, ClientView>;
  functionChoices: FunctionChoices;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(props.areas.length === 1 ? props.areas[0].id : null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => router.refresh();
  const guard = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };

  const fnFor = (p: Person) =>
    p.canGiveFunction && props.functionChoices?.functions.length
      ? { eventId: props.eventId, options: props.functionChoices.functions, value: props.functionChoices.assigned[p.id] ?? null }
      : undefined;
  const coordination = props.people.filter((p) => !p.teamId && (!p.areaId || p.role === "HEAD" || EVENT_LEVEL.includes(p.role)));

  return (
    <div>
      <FormError message={error} />

      {coordination.length > 0 && (
        <>
          <SectionTitle>Coordenação</SectionTitle>
          <Card className="divide-y divide-border p-0">
            {coordination.map((p) => (
              <PersonRow key={p.id} p={p} areaName={props.areas.find((a) => a.id === p.areaId)?.name} guard={guard}
                canManage={canManagePerson(p, props)} fn={fnFor(p)}
                clientView={p.role === "CLIENTE" && props.canGrantClientView ? (props.clientViews[p.id] ?? NO_VIEW) : undefined} />
            ))}
          </Card>
        </>
      )}

      <SectionTitle
        action={props.canAddArea ? <InlineAdd label="+ Área" placeholder="Nome da área (ex.: Segurança)" onSave={(name) => guard(() => api(`/api/events/${props.eventId}/areas`, { body: { name } }))} /> : undefined}
      >
        Áreas
      </SectionTitle>

      {props.areas.length === 0 && <Card className="text-center text-muted">Nenhuma área ainda. Comece criando uma (ex.: Infraestrutura).</Card>}

      <div className="space-y-3">
        {props.areas.map((area) => {
          const teams = props.teams.filter((t) => t.areaId === area.id);
          const count = props.people.filter((p) => p.areaId === area.id && p.active).length;
          const isOpen = open === area.id;
          return (
            <Card key={area.id} className="p-0">
              <button type="button" onClick={() => setOpen(isOpen ? null : area.id)} className="flex min-h-14 w-full items-center justify-between px-4 text-left">
                <span className="font-semibold">{area.name}</span>
                <span className="text-sm text-muted">{teams.length} {teams.length === 1 ? "equipe" : "equipes"} · {count} {count === 1 ? "pessoa" : "pessoas"} {isOpen ? "▴" : "▾"}</span>
              </button>
              {isOpen && (
                <div className="space-y-3 border-t border-border p-3">
                  {teams.map((team) => (
                    <TeamBlock key={team.id} team={team} area={area} eventId={props.eventId}
                      people={props.people.filter((p) => p.teamId === team.id)} guard={guard}
                      canManage={(p) => canManagePerson(p, props)} fnFor={fnFor} />
                  ))}
                  {teams.length === 0 && <p className="px-1 text-sm text-muted">Nenhuma equipe nesta área.</p>}
                  {props.functionChoices && props.functionChoices.functions.length === 0 && teams.length > 0 && (
                    <p className="px-1 text-xs text-muted">As funções aparecem aqui quando a pré-produção criar a lista de funções do evento.</p>
                  )}
                  {area.canAddTeam && (
                    <InlineAdd label="+ Equipe" placeholder="Nome da equipe (ex.: Elétrica)" block
                      onSave={(name) => guard(() => api(`/api/areas/${area.id}/teams`, { body: { name } }))} />
                  )}
                  {area.roles.includes("HEAD") && (
                    <AddPerson eventId={props.eventId} roles={["HEAD"]} areaId={area.id} label="+ Head da área" guard={guard} />
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {props.eventRoles.some((r) => EVENT_LEVEL.includes(r)) && (
        <>
          <SectionTitle>Gerentes, cliente e pré-produção</SectionTitle>
          <AddPerson
            eventId={props.eventId}
            roles={props.eventRoles.filter((r) => EVENT_LEVEL.includes(r))}
            label={props.eventRoles.includes("PRE_PRODUTOR") ? "+ Gerente, cliente ou pré-produtor" : "+ Gerente ou cliente"}
            guard={guard}
          />
        </>
      )}
    </div>
  );
}

function canManagePerson(p: Person, props: { areas: Area[]; eventRoles: Role[] }) {
  if (p.mine) return false;
  const roles = p.areaId ? props.areas.find((a) => a.id === p.areaId)?.roles ?? [] : props.eventRoles;
  return roles.includes(p.role);
}

function TeamBlock({ team, area, eventId, people, guard, canManage, fnFor }: {
  team: Team; area: Area; eventId: string; people: Person[];
  guard: (fn: () => Promise<unknown>) => Promise<boolean>; canManage: (p: Person) => boolean;
  fnFor: (p: Person) => FunctionPick | undefined;
}) {
  const [bulk, setBulk] = useState(false);
  const canAdd = area.roles.includes("OPERACIONAL");
  return (
    <div className="rounded-xl border border-border">
      <div className="flex items-center justify-between px-3 py-2">
        <p className="font-medium">{team.name}</p>
        <span className="text-xs text-muted">{people.filter((p) => p.active).length} ativos</span>
      </div>
      <div className="divide-y divide-border border-t border-border">
        {people.map((p) => <PersonRow key={p.id} p={p} guard={guard} canManage={canManage(p)} fn={fnFor(p)} />)}
        {people.length === 0 && <p className="px-3 py-3 text-sm text-muted">Ninguém nesta equipe ainda.</p>}
      </div>
      {canAdd && (
        <div className="space-y-2 border-t border-border p-2">
          <AddPerson eventId={eventId} roles={["OPERACIONAL"]} teamId={team.id} label="+ Pessoa" guard={guard} />
          <button type="button" onClick={() => setBulk(!bulk)} className="w-full py-2 text-sm text-primary">
            {bulk ? "Fechar" : "Colar lista de pessoas"}
          </button>
          {bulk && <BulkAdd eventId={eventId} teamId={team.id} onDone={() => setBulk(false)} guard={guard} />}
        </div>
      )}
    </div>
  );
}

type FunctionPick = { eventId: string; options: Fn[]; value: string | null };

function PersonRow({ p, areaName, guard, canManage, clientView, fn }: {
  p: Person; areaName?: string; guard: (fn: () => Promise<unknown>) => Promise<boolean>; canManage: boolean;
  /** Só para o Cliente, quando quem vê a tela pode liberar a visão dele. */
  clientView?: ClientView;
  /** Escolher a função desta pessoa (Pré-produção e o Head da área). */
  fn?: FunctionPick;
}) {
  const [link, setLink] = useState<string | null>(null);
  const state = !p.active ? "Inativo" : p.joined ? "Com acesso" : p.invited ? "Convidado" : "Sem acesso";

  async function invite() {
    await guard(async () => {
      const r = await api<{ path: string }>(`/api/participants/${p.id}/invitation`, { body: {} });
      const url = `${location.origin}${r.path}`;
      setLink(url);
      if (navigator.share) {
        await navigator.share({ title: "Acesso CORE 360", text: `${p.name}, este é seu acesso ao CORE 360:`, url }).catch(() => {});
      } else {
        await navigator.clipboard?.writeText(url).catch(() => {});
      }
    });
  }

  return (
    <div className={cx("px-3 py-3", !p.active && "opacity-60")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{p.name}{p.mine && <span className="text-muted"> (você)</span>}</p>
          <p className="truncate text-sm text-muted">
            {[p.jobTitle, p.role !== "OPERACIONAL" ? ROLE_LABEL[p.role] + (areaName ? ` · ${areaName}` : "") : null].filter(Boolean).join(" · ") || p.email}
          </p>
        </div>
        <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-xs",
          state === "Com acesso" ? "bg-emerald-500/20 text-emerald-200" : "bg-border text-muted")}>
          {state}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {p.phone && <a href={`tel:${p.phone.replace(/[^\d+]/g, "")}`} className="rounded-lg border border-border px-3 py-1.5 text-sm">📞 Ligar</a>}
        {p.phone && (
          <a href={`https://wa.me/${p.phone.replace(/\D/g, "")}`} target="_blank" rel="noopener" className="rounded-lg border border-border px-3 py-1.5 text-sm">WhatsApp</a>
        )}
        {canManage && p.active && !p.joined && (
          <button type="button" onClick={invite} className="rounded-lg border border-primary px-3 py-1.5 text-sm font-medium text-primary">
            {p.invited ? "Reenviar convite" : "Enviar convite"}
          </button>
        )}
        {canManage && (
          <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-sm"
            onClick={() => guard(() => api(`/api/participants/${p.id}`, { method: "PATCH", body: { active: !p.active } }))}>
            {p.active ? "Desativar" : "Reativar"}
          </button>
        )}
      </div>
      {fn && <FunctionSelect participantId={p.id} name={p.name} pick={fn} guard={guard} />}
      {clientView && p.active && <ClientViewSwitches participantId={p.id} view={clientView} guard={guard} />}
      {link && (
        <p className="mt-2 break-all rounded-lg bg-background p-2 text-xs">
          Link copiado (vale 7 dias, uso único): {link}
        </p>
      )}
    </div>
  );
}

const NO_VIEW: ClientView = { costs: false, team: false, progress: false };

function FunctionSelect({ participantId, name, pick, guard }: {
  participantId: string; name: string; pick: FunctionPick; guard: (fn: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <label className="mt-2 flex items-center gap-2 text-sm">
      <span className="shrink-0 text-muted">Função</span>
      <Select
        aria-label={`Função de ${name}`}
        className="min-h-10 py-1.5"
        value={pick.value ?? ""}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true);
          await guard(() => api(`/api/events/${pick.eventId}/people/${participantId}/function`, { method: "PUT", body: { functionId: e.target.value || null } }));
          setBusy(false);
        }}
      >
        <option value="">Sem função</option>
        {pick.options.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </Select>
    </label>
  );
}

const VIEW_OPTIONS: { key: keyof ClientView; label: string; hint: string }[] = [
  { key: "progress", label: "Andamento", hint: "chamados e planta" },
  { key: "team", label: "Equipe", hint: "áreas, equipes e pessoas" },
  { key: "costs", label: "Custos", hint: "planilha com valores" },
];

/** O que o Cliente acompanha: ele só olha, e só o que estiver ligado aqui. */
function ClientViewSwitches({ participantId, view, guard }: {
  participantId: string; view: ClientView; guard: (fn: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState<keyof ClientView | null>(null);
  return (
    <div className="mt-3 rounded-xl border border-border bg-background p-3">
      <p className="text-sm font-semibold">O que este cliente vê</p>
      <p className="text-xs text-muted">Ele só olha, não muda nada.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {VIEW_OPTIONS.map((o) => {
          const on = view[o.key];
          return (
            <button
              key={o.key}
              type="button"
              role="switch"
              aria-checked={on}
              disabled={!!busy}
              onClick={async () => {
                setBusy(o.key);
                await guard(() => api(`/api/participants/${participantId}/client-view`, { method: "PATCH", body: { [o.key]: !on } }));
                setBusy(null);
              }}
              className={cx(
                "flex min-h-11 items-center gap-2 rounded-xl border px-3 text-left text-sm transition",
                on ? "border-primary bg-primary/15 text-foreground" : "border-border text-muted hover:border-primary/60",
              )}
            >
              <span aria-hidden className={cx("relative h-5 w-9 shrink-0 rounded-full transition", on ? "bg-primary" : "bg-border")}>
                <span className={cx("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", on ? "left-[18px]" : "left-0.5")} />
              </span>
              <span>
                <span className="block font-medium">{o.label}</span>
                <span className="block text-xs text-muted">{o.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AddPerson({ eventId, roles, teamId, areaId, label, guard }: {
  eventId: string; roles: Role[]; teamId?: string; areaId?: string; label: string;
  guard: (fn: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>{label}</Button>;
  }
  return (
    <form
      className="space-y-3 rounded-xl bg-background p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const ok = await guard(() =>
          api(`/api/events/${eventId}/participants`, {
            body: {
              name: f.get("name"), email: f.get("email"), phone: f.get("phone") || null,
              jobTitle: f.get("jobTitle") || null, role: f.get("role"), teamId: teamId ?? null, areaId: areaId ?? null,
            },
          }),
        );
        if (ok) setOpen(false);
      }}
    >
      <label className="block"><Label>Nome</Label><Input name="name" required maxLength={120} autoFocus /></label>
      <label className="block"><Label>E-mail</Label><Input name="email" type="email" inputMode="email" required /></label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block"><Label hint="(opcional)">Telefone</Label><Input name="phone" type="tel" inputMode="tel" /></label>
        <label className="block"><Label hint="(opcional)">Função</Label><Input name="jobTitle" placeholder="Eletricista" /></label>
      </div>
      {roles.length > 1 ? (
        <label className="block">
          <Label>Perfil</Label>
          <Select name="role" defaultValue={roles[0]}>
            {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </Select>
        </label>
      ) : (
        <input type="hidden" name="role" value={roles[0]} />
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
        <Button type="submit">Salvar</Button>
      </div>
    </form>
  );
}

/** Colar lista (do Excel ou WhatsApp): uma pessoa por linha — nome; e-mail; telefone; função. */
function BulkAdd({ eventId, teamId, onDone, guard }: {
  eventId: string; teamId: string; onDone: () => void; guard: (fn: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const rows = text.split("\n").map((l) => l.split(/[;\t,]/).map((c) => c.trim())).filter((c) => c[0] && c[1]);

  return (
    <div className="space-y-2">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={5}
        placeholder={"João Silva; joao@email.com; 11 99999-0000; Eletricista\nMaria Souza; maria@email.com; ; Técnica"} />
      <p className="text-xs text-muted">{rows.length} pessoa(s) reconhecida(s). Separe por ponto e vírgula ou cole direto do Excel.</p>
      {result && <p className="text-sm">{result}</p>}
      <Button className="w-full" disabled={!rows.length}
        onClick={async () => {
          let ok = 0;
          const failed: string[] = [];
          for (const [name, email, phone, jobTitle] of rows) {
            try {
              await api(`/api/events/${eventId}/participants`, {
                body: { name, email, phone: phone || null, jobTitle: jobTitle || null, role: "OPERACIONAL", teamId },
              });
              ok++;
            } catch (e) {
              failed.push(`${name}: ${(e as Error).message}`);
            }
          }
          await guard(async () => {});
          setResult(`${ok} adicionada(s).${failed.length ? ` Não entraram: ${failed.join("; ")}` : ""}`);
          if (!failed.length) { setText(""); onDone(); }
        }}>
        Adicionar {rows.length || ""} pessoa(s)
      </Button>
    </div>
  );
}

function InlineAdd({ label, placeholder, onSave, block }: { label: string; placeholder: string; onSave: (name: string) => Promise<boolean>; block?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!open) {
    return block
      ? <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>{label}</Button>
      : <button type="button" className="text-sm font-semibold text-primary" onClick={() => setOpen(true)}>{label}</button>;
  }
  return (
    <form className={cx("flex gap-2", !block && "fixed inset-x-0 bottom-24 z-40 mx-auto max-w-2xl px-4 lg:bottom-8 lg:left-60")}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const name = String(new FormData(e.currentTarget).get("name") ?? "");
        if (await onSave(name)) setOpen(false);
        setBusy(false);
      }}>
      <Input name="name" required maxLength={80} placeholder={placeholder} autoFocus className="flex-1 shadow-lg" />
      <Button type="submit" disabled={busy}>Criar</Button>
      <Button type="button" variant="secondary" onClick={() => setOpen(false)}>×</Button>
    </form>
  );
}
