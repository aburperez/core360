"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, EmptyState, cx } from "@/components/ui";
import { FormError, Input } from "@/components/field";
import { api } from "@/components/api-client";
import { InviteShare } from "@/components/invite-share";
import { formatPhone } from "@/lib/phone";

export type InviteState = "NONE" | "SENT" | "EXPIRED" | "ACCEPTED";

export type AgencyInviteRow = {
  id: string;
  name: string;
  status: "ACTIVE" | "SUSPENDED";
  support: boolean;
  directors: number;
  /** O contato que abriu a agência: Admin e diretor de produção dela. */
  contact: { id: string; name: string; email: string; phone: string | null; active: boolean; invite: InviteState; inviteExpiresAt: string | null } | null;
};

const FILTERS: { key: InviteState | "ALL"; label: string }[] = [
  { key: "ALL", label: "Todas" },
  { key: "NONE", label: "Falta convidar" },
  { key: "SENT", label: "Convite enviado" },
  { key: "EXPIRED", label: "Convite vencido" },
  { key: "ACCEPTED", label: "Já entraram" },
];

const STATE: Record<InviteState, { label: string; tone: string }> = {
  NONE: { label: "Falta convidar", tone: "bg-amber-500/20 text-amber-200" },
  SENT: { label: "Convite enviado", tone: "bg-primary/20 text-primary" },
  EXPIRED: { label: "Convite vencido", tone: "bg-red-500/20 text-red-200" },
  ACCEPTED: { label: "Já entrou", tone: "bg-emerald-500/20 text-emerald-200" },
};

const day = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });

/**
 * Painel de convites do Admin da plataforma: uma linha por agência, com o
 * contato dela e a situação do convite. O convite sai daqui mesmo, sem abrir
 * a agência; depois o contato cadastra os diretores e os produtores sozinho.
 */
export function AgencyInvitePanel({ rows }: { rows: AgencyInviteRow[] }) {
  const [filter, setFilter] = useState<InviteState | "ALL">("ALL");
  const count = (k: InviteState) => rows.filter((r) => r.contact?.invite === k).length;
  const shown = filter === "ALL" ? rows : rows.filter((r) => r.contact?.invite === filter);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="tablist">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={cx(
              "rounded-full border px-3 py-1.5 text-sm",
              filter === f.key ? "border-primary bg-primary/15 text-primary" : "border-border text-muted",
            )}
          >
            {f.label} ({f.key === "ALL" ? rows.length : count(f.key)})
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <EmptyState title={rows.length ? "Nenhuma agência nesta situação" : "Nenhuma agência ainda"}>
          {rows.length ? "Escolha outro filtro acima." : "Abra a primeira acima."}
        </EmptyState>
      ) : (
        <Card className="divide-y divide-border p-0">
          {shown.map((r) => <AgencyRow key={r.id} r={r} />)}
        </Card>
      )}
    </div>
  );
}

function AgencyRow({ r }: { r: AgencyInviteRow }) {
  const router = useRouter();
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editPhone, setEditPhone] = useState(false);
  const c = r.contact;
  const suspended = r.status === "SUSPENDED";
  const canInvite = !!c && c.active && c.invite !== "ACCEPTED" && !suspended;

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      router.refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  return (
    <div className={cx("px-4 py-3", suspended && "opacity-70")}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <Link href={`/agencias/${r.id}`} className="block truncate font-semibold hover:text-primary">
            {r.name} <span className="text-primary">›</span>
          </Link>
          {c ? (
            <p className="truncate text-sm text-muted">
              {c.name} · {c.email}{c.phone ? ` · ${formatPhone(c.phone)}` : ""}
            </p>
          ) : (
            <p className="text-sm text-muted">Sem contato cadastrado</p>
          )}
          <p className="truncate text-xs text-muted">
            {r.directors} {r.directors === 1 ? "diretor" : "diretores"} ·{" "}
            <span className={r.support ? "text-emerald-300" : "text-amber-300"}>{r.support ? "Suporte autorizado" : "Sem Suporte"}</span>
            {suspended && <span className="text-red-300"> · Suspensa</span>}
          </p>
        </div>
        {c && (
          <span className={cx("w-fit shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold", STATE[c.invite].tone)}>
            {STATE[c.invite].label}
            {c.invite === "SENT" && c.inviteExpiresAt && ` · até ${day(c.inviteExpiresAt)}`}
          </span>
        )}
      </div>

      {c && canInvite && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border border-primary px-3 py-1.5 text-sm font-medium text-primary"
            onClick={() =>
              run(async () => {
                const res = await api<{ path: string }>(`/api/agency-admins/${c.id}/invitation`, { body: {} });
                setLink(`${location.origin}${res.path}`);
              })
            }
          >
            {c.invite === "NONE" ? "Gerar convite" : "Mandar de novo"}
          </button>
          {!c.phone && !editPhone && (
            <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-sm" onClick={() => setEditPhone(true)}>
              + Celular
            </button>
          )}
        </div>
      )}

      {c && editPhone && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const value = String(new FormData(e.currentTarget).get("phone") ?? "");
            if (await run(() => api(`/api/agency-admins/${c.id}`, { method: "PATCH", body: { phone: value } }))) setEditPhone(false);
          }}
        >
          <Input name="phone" type="tel" inputMode="tel" placeholder="(11) 98765-4321" required autoFocus aria-label={`Celular de ${c.name}`} />
          <button type="submit" className="shrink-0 rounded-lg border border-primary px-3 text-sm font-medium text-primary">Salvar</button>
          <button type="button" className="shrink-0 rounded-lg border border-border px-3 text-sm" onClick={() => setEditPhone(false)}>Cancelar</button>
        </form>
      )}

      <FormError message={error} />
      {c && link && <InviteShare url={link} name={c.name} as="diretor de produção" phone={c.phone} />}
    </div>
  );
}
