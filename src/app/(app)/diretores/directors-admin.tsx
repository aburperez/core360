"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, EmptyState, SectionTitle, cx } from "@/components/ui";
import { FormError, Input, Label } from "@/components/field";
import { api } from "@/components/api-client";

type Director = {
  id: string; name: string; email: string; phone: string | null; jobTitle: string | null; active: boolean;
  me: boolean; linked: boolean; invited: boolean; events: { id: string; name: string }[]; createdAt: string;
};

export function DirectorsAdmin({ directors, agencyId, canManage }: { directors: Director[]; agencyId: string; canManage: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const guard = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      router.refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };

  return (
    <div className="space-y-4">
      <FormError message={error} />
      {canManage && <AddDirector guard={guard} agencyId={agencyId} />}
      <SectionTitle>Diretores de produção ({directors.length})</SectionTitle>
      {directors.length === 0 ? (
        <EmptyState title="Nenhum diretor cadastrado">Cadastre acima quem administra a agência e cuida de todos os eventos.</EmptyState>
      ) : (
        <Card className="divide-y divide-border p-0">
          {directors.map((d) => <DirectorRow key={d.id} d={d} guard={guard} canManage={canManage} />)}
        </Card>
      )}
    </div>
  );
}

function DirectorRow({ d, guard, canManage }: { d: Director; guard: (fn: () => Promise<unknown>) => Promise<boolean>; canManage: boolean }) {
  const [link, setLink] = useState<string | null>(null);
  const state = !d.active ? "Inativo" : d.linked ? "Com acesso" : d.invited ? "Convidado" : "Sem acesso";

  async function invite() {
    await guard(async () => {
      const r = await api<{ path: string }>(`/api/directors/${d.id}/invitation`, { body: {} });
      const url = `${location.origin}${r.path}`;
      setLink(url);
      if (navigator.share) {
        await navigator.share({ title: "Acesso CORE 360", text: `${d.name}, este é seu acesso ao CORE 360:`, url }).catch(() => {});
      } else {
        await navigator.clipboard?.writeText(url).catch(() => {});
      }
    });
  }

  return (
    <div className={cx("px-4 py-3", !d.active && "opacity-60")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{d.name}{d.me && <span className="text-muted"> (você)</span>}</p>
          <p className="truncate text-sm text-muted">{[d.jobTitle, d.email].filter(Boolean).join(" · ")}</p>
        </div>
        <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-xs",
          state === "Com acesso" ? "bg-emerald-500/20 text-emerald-200" : "bg-border text-muted")}>
          {state}
        </span>
      </div>
      <p className="mt-1 text-sm">
        {d.events.length === 0
          ? <span className="text-muted">Nenhum evento aberto agora. Entra nos próximos automaticamente.</span>
          : <>Gerente em <b>{d.events.length}</b> {d.events.length === 1 ? "evento" : "eventos"}: <span className="text-muted">{d.events.map((e) => e.name).join(", ")}</span></>}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {d.phone && (
          <a href={`https://wa.me/${d.phone.replace(/\D/g, "")}`} target="_blank" rel="noopener" className="rounded-lg border border-border px-3 py-1.5 text-sm">WhatsApp</a>
        )}
        {canManage && d.active && !d.linked && (
          <button type="button" onClick={invite} className="rounded-lg border border-primary px-3 py-1.5 text-sm font-medium text-primary">
            {d.invited ? "Reenviar convite" : "Enviar convite"}
          </button>
        )}
        {canManage && !d.me && (
          <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-sm"
            onClick={() => guard(() => api(`/api/directors/${d.id}`, { method: "PATCH", body: { active: !d.active } }))}>
            {d.active ? "Desativar" : "Reativar"}
          </button>
        )}
      </div>
      {link && (
        <p className="mt-2 break-all rounded-lg bg-background p-2 text-xs">
          Link copiado (vale 7 dias, uso único, serve para a agência e todos os eventos): {link}
        </p>
      )}
    </div>
  );
}

function AddDirector({ guard, agencyId }: { guard: (fn: () => Promise<unknown>) => Promise<boolean>; agencyId: string }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return <Button className="w-full" onClick={() => setOpen(true)}>+ Cadastrar diretor de produção</Button>;
  }
  return (
    <Card>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const ok = await guard(() =>
            api("/api/directors", {
              body: { agencyId, name: f.get("name"), email: f.get("email"), phone: f.get("phone") || null, jobTitle: f.get("jobTitle") || null },
            }),
          );
          if (ok) setOpen(false);
        }}
      >
        <label className="block"><Label>Nome</Label><Input name="name" required maxLength={120} autoFocus /></label>
        <label className="block"><Label>E-mail</Label><Input name="email" type="email" inputMode="email" required /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><Label hint="(opcional)">Telefone</Label><Input name="phone" type="tel" inputMode="tel" /></label>
          <label className="block"><Label hint="(opcional)">Cargo</Label><Input name="jobTitle" placeholder="Diretor de produção" /></label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button type="submit">Salvar</Button>
        </div>
      </form>
    </Card>
  );
}
