"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, EmptyState, SectionTitle, cx } from "@/components/ui";
import { FormError, Input, Label } from "@/components/field";
import { api } from "@/components/api-client";

type Client = {
  id: string; name: string; document: string | null; contactName: string | null; email: string | null; phone: string | null;
  status: "ACTIVE" | "INACTIVE"; events: number;
};

const FIELDS = ["name", "contactName", "email", "phone", "document"] as const;

function ClientFields({ c }: { c?: Client }) {
  return (
    <>
      <label className="block"><Label>Nome do cliente</Label><Input name="name" required maxLength={120} defaultValue={c?.name ?? ""} autoFocus={!c} /></label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block"><Label hint="(opcional)">Contato</Label><Input name="contactName" maxLength={120} defaultValue={c?.contactName ?? ""} /></label>
        <label className="block"><Label hint="(opcional)">Telefone</Label><Input name="phone" type="tel" inputMode="tel" maxLength={30} defaultValue={c?.phone ?? ""} /></label>
        <label className="block"><Label hint="(opcional)">E-mail</Label><Input name="email" type="email" inputMode="email" defaultValue={c?.email ?? ""} /></label>
        <label className="block"><Label hint="(opcional)">CNPJ ou CPF</Label><Input name="document" maxLength={30} defaultValue={c?.document ?? ""} /></label>
      </div>
    </>
  );
}

const read = (form: HTMLFormElement) => {
  const f = new FormData(form);
  return Object.fromEntries(FIELDS.map((k) => [k, String(f.get(k) ?? "")]));
};

export function ClientsAdmin({ clients, agencyId }: { clients: Client[]; agencyId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
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
      {open ? (
        <Card>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await guard(() => api("/api/clients", { body: { agencyId, ...read(e.currentTarget) } }));
              if (ok) setOpen(false);
            }}
          >
            <ClientFields />
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit">Salvar</Button>
            </div>
          </form>
        </Card>
      ) : (
        <Button className="w-full sm:w-auto" onClick={() => setOpen(true)}>+ Novo cliente</Button>
      )}

      <SectionTitle>Clientes ({clients.length})</SectionTitle>
      {clients.length === 0 ? (
        <EmptyState title="Nenhum cliente ainda">Cadastre o primeiro para poder criar eventos.</EmptyState>
      ) : (
        <Card className="divide-y divide-border p-0">
          {clients.map((c) => <ClientRow key={c.id} c={c} guard={guard} />)}
        </Card>
      )}
    </div>
  );
}

function ClientRow({ c, guard }: { c: Client; guard: (fn: () => Promise<unknown>) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const active = c.status === "ACTIVE";
  if (editing) {
    return (
      <form
        className="space-y-3 px-4 py-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await guard(() => api(`/api/clients/${c.id}`, { method: "PATCH", body: read(e.currentTarget) }));
          if (ok) setEditing(false);
        }}
      >
        <ClientFields c={c} />
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" onClick={() => setEditing(false)}>Cancelar</Button>
          <Button type="submit">Salvar</Button>
        </div>
      </form>
    );
  }
  return (
    <div className={cx("px-4 py-3", !active && "opacity-60")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{c.name}</p>
          <p className="truncate text-sm text-muted">{[c.contactName, c.phone, c.email].filter(Boolean).join(" · ") || "Sem contato"}</p>
        </div>
        <span className="shrink-0 text-sm text-muted">{c.events} {c.events === 1 ? "evento" : "eventos"}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-sm" onClick={() => setEditing(true)}>Editar</button>
        <button
          type="button"
          className="rounded-lg border border-border px-3 py-1.5 text-sm"
          onClick={() => guard(() => api(`/api/clients/${c.id}`, { method: "PATCH", body: { status: active ? "INACTIVE" : "ACTIVE" } }))}
        >
          {active ? "Desativar" : "Reativar"}
        </button>
      </div>
    </div>
  );
}
