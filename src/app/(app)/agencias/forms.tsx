"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, cx } from "@/components/ui";
import { FormError, Input, Label } from "@/components/field";
import { api } from "@/components/api-client";

type Guard = (fn: () => Promise<unknown>) => Promise<boolean>;

function useGuard() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const guard: Guard = async (fn) => {
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
  return { error, guard, router };
}

/** Abre o compartilhar do celular (ou copia) e devolve o link completo. */
async function shareInvite(path: string, name: string, as = "diretor de produção") {
  const url = `${location.origin}${path}`;
  if (navigator.share) {
    await navigator.share({ title: "Acesso CORE 360", text: `${name}, este é seu acesso de ${as} ao CORE 360:`, url }).catch(() => {});
  } else {
    await navigator.clipboard?.writeText(url).catch(() => {});
  }
  return url;
}

function InviteLink({ url }: { url: string }) {
  return (
    <p className="mt-2 break-all rounded-lg bg-background p-2 text-xs">
      Link copiado (vale 7 dias e só pode ser usado uma vez): {url}
    </p>
  );
}

/** Nova agência com o primeiro diretor de produção. Mostra o link do convite uma vez. */
export function NewAgencyForm() {
  const { error, guard } = useGuard();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  if (!open) {
    return (
      <div>
        <Button className="w-full sm:w-auto" onClick={() => { setOpen(true); setLink(null); }}>+ Nova agência</Button>
        {link && <InviteLink url={link} />}
      </div>
    );
  }
  return (
    <Card>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const adminName = String(f.get("adminName") ?? "");
          let path = "";
          const ok = await guard(async () => {
            const r = await api<{ invite: { path: string } }>("/api/agencies", {
              body: { name: f.get("name"), adminName, adminEmail: f.get("adminEmail") },
            });
            path = r.invite.path;
          });
          if (ok) {
            setLink(await shareInvite(path, adminName));
            setOpen(false);
          }
        }}
      >
        <label className="block"><Label>Nome da agência</Label><Input name="name" required maxLength={120} autoFocus /></label>
        <p className="pt-1 text-sm font-semibold">Primeiro diretor de produção da agência</p>
        <label className="block"><Label>Nome</Label><Input name="adminName" required maxLength={120} /></label>
        <label className="block"><Label>E-mail</Label><Input name="adminEmail" type="email" inputMode="email" required /></label>
        <FormError message={error} />
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button type="submit">Criar e convidar</Button>
        </div>
      </form>
    </Card>
  );
}

/** Nome e situação da agência: só o Admin da plataforma muda. */
export function AgencySettings({ agency }: { agency: { id: string; name: string; status: "ACTIVE" | "SUSPENDED" } }) {
  const { error, guard } = useGuard();
  const suspended = agency.status === "SUSPENDED";
  return (
    <Card className="space-y-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const name = String(new FormData(e.currentTarget).get("name") ?? "");
          guard(() => api(`/api/agencies/${agency.id}`, { method: "PATCH", body: { name } }));
        }}
      >
        <Input name="name" required maxLength={120} defaultValue={agency.name} aria-label="Nome da agência" />
        <Button type="submit" variant="secondary" className="shrink-0">Salvar</Button>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {suspended ? "Suspensa: ninguém da agência entra até você reativar." : "Ativa: os diretores e as equipes dos eventos entram normalmente."}
        </p>
        <Button
          variant={suspended ? "success" : "secondary"}
          className={cx("min-h-10 text-sm", !suspended && "text-red-300")}
          onClick={() => {
            if (!suspended && !confirm(`Suspender “${agency.name}”? Ninguém da agência consegue entrar até você reativar. Nada é apagado.`)) return;
            guard(() => api(`/api/agencies/${agency.id}`, { method: "PATCH", body: { status: suspended ? "ACTIVE" : "SUSPENDED" } }));
          }}
        >
          {suspended ? "Reativar agência" : "Suspender agência"}
        </Button>
      </div>
      <FormError message={error} />
    </Card>
  );
}

type Admin = { id: string; name: string; email: string; role: "ADMIN" | "SUPORTE"; active: boolean; linked: boolean };

/**
 * Diretores de produção ou Suporte da agência: convite, desativar, cadastrar outro. Sem
 * canManage a lista é só para ver (o servidor recusa do mesmo jeito).
 */
export function AgencyAdmins({
  agencyId, admins, me, role = "ADMIN", canManage,
}: { agencyId: string; admins: Admin[]; me: string; role?: "ADMIN" | "SUPORTE"; canManage: boolean }) {
  const { error, guard } = useGuard();
  const [open, setOpen] = useState(false);
  const label = role === "SUPORTE" ? "Suporte" : "diretor de produção";
  return (
    <div className="space-y-3">
      {admins.length > 0 && (
        <Card className="divide-y divide-border p-0">
          {admins.map((a) => <AdminRow key={a.id} a={a} guard={guard} isMe={a.email === me} canManage={canManage} label={label} />)}
        </Card>
      )}
      <FormError message={error} />
      {!canManage ? null : open ? (
        <Card>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const ok = await guard(() => api(`/api/agencies/${agencyId}/admins`, { body: { name: f.get("name"), email: f.get("email"), role } }));
              if (ok) setOpen(false);
            }}
          >
            <label className="block"><Label>Nome</Label><Input name="name" required maxLength={120} autoFocus /></label>
            <label className="block"><Label>E-mail</Label><Input name="email" type="email" inputMode="email" required /></label>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit">Salvar</Button>
            </div>
          </form>
        </Card>
      ) : (
        <Button variant="secondary" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
          {role === "SUPORTE" ? "+ Autorizar Suporte" : "+ Outro diretor de produção"}
        </Button>
      )}
    </div>
  );
}

function AdminRow({ a, guard, isMe, canManage, label }: { a: Admin; guard: Guard; isMe: boolean; canManage: boolean; label: string }) {
  const [link, setLink] = useState<string | null>(null);
  const state = !a.active ? "Inativo" : a.linked ? "Com acesso" : "Sem acesso";
  return (
    <div className={cx("px-4 py-3", !a.active && "opacity-60")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{a.name}{isMe && <span className="text-muted"> (você)</span>}</p>
          <p className="truncate text-sm text-muted">{a.email}</p>
        </div>
        <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-xs", state === "Com acesso" ? "bg-emerald-500/20 text-emerald-200" : "bg-border text-muted")}>
          {state}
        </span>
      </div>
      {canManage && (
        <div className="mt-2 flex flex-wrap gap-2">
          {a.active && !a.linked && (
            <button
              type="button"
              className="rounded-lg border border-primary px-3 py-1.5 text-sm font-medium text-primary"
              onClick={() =>
                guard(async () => {
                  const r = await api<{ path: string }>(`/api/agency-admins/${a.id}/invitation`, { body: {} });
                  setLink(await shareInvite(r.path, a.name, label));
                })
              }
            >
              Enviar convite
            </button>
          )}
          {!isMe && (
            <button
              type="button"
              className="rounded-lg border border-border px-3 py-1.5 text-sm"
              onClick={() => guard(() => api(`/api/agency-admins/${a.id}`, { method: "PATCH", body: { active: !a.active } }))}
            >
              {label === "Suporte" ? (a.active ? "Desligar acesso" : "Religar acesso") : a.active ? "Desativar" : "Reativar"}
            </button>
          )}
        </div>
      )}
      {link && <InviteLink url={link} />}
    </div>
  );
}
