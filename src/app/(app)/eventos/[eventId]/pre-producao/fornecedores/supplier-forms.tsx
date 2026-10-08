"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/components/api-client";
import { FormError, Input, Label, Select, Textarea } from "@/components/field";
import { Icon } from "@/components/icons";
import { Button, Card, cx } from "@/components/ui";
import { CATEGORY, ITEM_CATEGORIES, type ItemCategory } from "@/modules/items/item-meta";

/** Mensagem do erro, com o primeiro campo que a validação recusou. */
function message(e: unknown) {
  if (e instanceof ApiError && e.details && typeof e.details === "object") {
    const first = Object.values(e.details as Record<string, string[] | undefined>).find((v) => v?.length)?.[0];
    if (first) return first;
  }
  return (e as Error).message;
}

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async <T,>(fn: () => Promise<T>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      router.refresh();
      return r ?? true;
    } catch (e) {
      setError(message(e));
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, router };
}

export const cnpjMask = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 14);
  return d.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2");
};

/** Busca, categoria e arquivados: cada escolha muda a URL. */
export function SupplierFilters({ archivedCount }: { archivedCount: number }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(next.size ? `${path}?${next}` : path, { scroll: false });
  };
  // Busca enquanto digita, sem pedir a cada tecla.
  useEffect(() => {
    if ((params.get("q") ?? "") === q) return;
    const t = setTimeout(() => set("q", q.trim()), 350);
    return () => clearTimeout(t);
  });
  const archived = params.get("arquivados") === "1";
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_14rem_auto] sm:items-end">
      <label className="block min-w-0">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Buscar</span>
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome, CNPJ, cidade ou especialidade" className="min-h-10 py-1.5" />
      </label>
      <label className="block min-w-0">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Categoria</span>
        <Select aria-label="Categoria" className="min-h-10 py-1.5" value={params.get("categoria") ?? ""} onChange={(e) => set("categoria", e.target.value)}>
          <option value="">Todas</option>
          {ITEM_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY[c].label}</option>)}
        </Select>
      </label>
      {(archivedCount > 0 || archived) && (
        <Button variant="ghost" className="min-h-10 px-3 text-sm" onClick={() => set("arquivados", archived ? "" : "1")}>
          {archived ? "Ver os ativos" : `Arquivados (${archivedCount})`}
        </Button>
      )}
    </div>
  );
}

export type SupplierData = {
  id: string; cnpj: string; companyName: string; tradeName: string | null; contactName: string | null; phone: string | null;
  whatsapp: string | null; email: string | null; city: string | null; state: string | null; region: string | null;
  categories: ItemCategory[]; specialty: string | null; team: string | null; equipment: string | null; capacity: string | null; notes: string | null;
};

/** Cadastro ou correção de um fornecedor. O CNPJ só entra no cadastro. */
export function SupplierForm({ eventId, supplier, onDone }: { eventId: string; supplier?: SupplierData; onDone?: (id?: string) => void }) {
  const [cnpj, setCnpj] = useState(supplier ? cnpjMask(supplier.cnpj) : "");
  const [cats, setCats] = useState<ItemCategory[]>(supplier?.categories ?? []);
  const { busy, error, run } = useAction();
  const field = (name: keyof SupplierData, label: string, opts: { hint?: string; max?: number; type?: string; placeholder?: string; required?: boolean; wide?: boolean } = {}) => (
    <label className={cx("block", opts.wide && "sm:col-span-2")}>
      <Label hint={opts.hint ?? (opts.required ? undefined : "(opcional)")}>{label}</Label>
      <Input name={name} type={opts.type ?? "text"} maxLength={opts.max ?? 160} required={opts.required} placeholder={opts.placeholder}
        defaultValue={(supplier?.[name] as string | null | undefined) ?? ""} />
    </label>
  );
  const area = (name: keyof SupplierData, label: string, placeholder: string) => (
    <label className="block">
      <Label hint="(opcional)">{label}</Label>
      <Textarea name={name} rows={2} maxLength={1000} placeholder={placeholder} defaultValue={(supplier?.[name] as string | null | undefined) ?? ""} />
    </label>
  );
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const get = (k: string) => String(f.get(k) ?? "");
        const data = {
          companyName: get("companyName"), tradeName: get("tradeName"), contactName: get("contactName"), phone: get("phone"),
          whatsapp: get("whatsapp"), email: get("email"), city: get("city"), state: get("state"), region: get("region"),
          categories: cats, specialty: get("specialty"), team: get("team"), equipment: get("equipment"), capacity: get("capacity"), notes: get("notes"),
        };
        const r = await run(() => supplier
          ? api<{ id: string }>(`/api/events/${eventId}/suppliers/${supplier.id}`, { method: "PATCH", body: data })
          : api<{ id: string }>(`/api/events/${eventId}/suppliers`, { body: { ...data, cnpj } }));
        if (r) onDone?.(typeof r === "object" ? r.id : undefined);
      }}
    >
      {supplier ? (
        <div className="block">
          <Label>CNPJ</Label>
          <p className="py-2 tabular-nums">{cnpjMask(supplier.cnpj)}</p>
        </div>
      ) : (
        <label className="block">
          <Label>CNPJ</Label>
          <Input value={cnpj} onChange={(e) => setCnpj(cnpjMask(e.target.value))} inputMode="numeric" required placeholder="00.000.000/0000-00" />
        </label>
      )}
      {field("companyName", "Razão social", { required: true })}
      {field("tradeName", "Nome fantasia")}
      {field("contactName", "Contato", { max: 120 })}
      {field("phone", "Telefone", { type: "tel", max: 30, placeholder: "(11) 98765-4321" })}
      {field("whatsapp", "WhatsApp", { type: "tel", max: 30, placeholder: "(11) 98765-4321" })}
      {field("email", "E-mail", { type: "email" })}
      <div className="grid grid-cols-[1fr_5rem] gap-3">
        {field("city", "Cidade", { max: 120 })}
        <label className="block">
          <Label hint="UF">Estado</Label>
          <Input name="state" maxLength={2} defaultValue={supplier?.state ?? ""} placeholder="SP" className="uppercase" />
        </label>
      </div>
      {field("region", "Região de atendimento", { max: 300, placeholder: "Ex.: Grande SP e interior", wide: true })}
      <fieldset className="sm:col-span-2">
        <Label hint="(o app sugere o fornecedor nas cotações destas categorias)">Categorias</Label>
        <div className="flex flex-wrap gap-1.5">
          {ITEM_CATEGORIES.map((c) => {
            const on = cats.includes(c);
            return (
              <button
                key={c} type="button" aria-pressed={on}
                onClick={() => setCats(on ? cats.filter((x) => x !== c) : [...cats, c])}
                className={cx("rounded-full border px-3 py-1 text-sm transition",
                  on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/60")}
              >
                {CATEGORY[c].label}
              </button>
            );
          })}
        </div>
      </fieldset>
      {field("specialty", "Especialidade", { max: 300, placeholder: "Ex.: geradores de grande porte", wide: true })}
      {area("team", "Equipe", "Quantas pessoas, operadores, técnicos")}
      {area("equipment", "Equipamentos", "O que tem de equipamento próprio")}
      {area("capacity", "Capacidade", "Ex.: atende até 3 eventos grandes no mesmo fim de semana")}
      <label className="block">
        <Label hint="(opcional)">Observações</Label>
        <Textarea name="notes" rows={2} maxLength={2000} defaultValue={supplier?.notes ?? ""} />
      </label>
      <div className="sm:col-span-2"><FormError message={error} /></div>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={busy}>{supplier ? "Salvar" : "Cadastrar fornecedor"}</Button>
        {onDone && <Button type="button" variant="secondary" onClick={() => onDone()}>Cancelar</Button>}
      </div>
    </form>
  );
}

/** Botão "Novo fornecedor" da lista, que abre o cadastro e leva à ficha. */
export function NewSupplier({ eventId }: { eventId: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  if (!open) return <Button onClick={() => setOpen(true)}><Icon name="plus" className="mr-1 h-4 w-4" />Novo fornecedor</Button>;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center" role="dialog" aria-label="Novo fornecedor">
      <Card className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto">
        <p className="mb-3 font-semibold">Novo fornecedor</p>
        <SupplierForm
          eventId={eventId}
          onDone={(id) => {
            setOpen(false);
            if (id) router.push(`/eventos/${eventId}/pre-producao/fornecedores/${id}`);
          }}
        />
      </Card>
    </div>
  );
}

/** Editar os dados na ficha. */
export function EditSupplier({ eventId, supplier }: { eventId: string; supplier: SupplierData }) {
  const [open, setOpen] = useState(false);
  if (!open) return <Button variant="secondary" onClick={() => setOpen(true)}>Editar dados</Button>;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center" role="dialog" aria-label="Editar fornecedor">
      <Card className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto">
        <p className="mb-3 font-semibold">Editar {supplier.companyName}</p>
        <SupplierForm eventId={eventId} supplier={supplier} onDone={() => setOpen(false)} />
      </Card>
    </div>
  );
}

/** Arquivar ou reativar (diretor). */
export function ArchiveSupplier({ eventId, supplierId, archived, name }: { eventId: string; supplierId: string; archived: boolean; name: string }) {
  const { busy, error, run } = useAction();
  return (
    <div>
      <Button
        variant="ghost" className={cx("min-h-10 px-3 text-sm", !archived && "text-red-300")} disabled={busy}
        onClick={() => {
          if (archived || confirm(`Arquivar ${name}? Ele sai da lista e das cotações novas. O histórico fica guardado.`)) {
            run(() => api(`/api/events/${eventId}/suppliers/${supplierId}/archive`, { body: { archived: !archived } }));
          }
        }}
      >
        {archived ? "Reativar fornecedor" : "Arquivar fornecedor"}
      </Button>
      <FormError message={error} />
    </div>
  );
}

export type BonusData = { kind: "PERCENTUAL" | "VALOR"; value: number; notes: string | null; updatedBy: string; updatedAt: string | Date };

/** Bonificação: o diretor preenche, muda ou tira. */
export function BonusForm({ eventId, supplierId, bonus }: { eventId: string; supplierId: string; bonus: BonusData | null }) {
  const [open, setOpen] = useState(!bonus);
  const [kind, setKind] = useState<BonusData["kind"]>(bonus?.kind ?? "PERCENTUAL");
  const { busy, error, run } = useAction();
  const url = `/api/events/${eventId}/suppliers/${supplierId}/bonus`;
  if (!open) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" className="min-h-10 px-3 text-sm" onClick={() => setOpen(true)}>Mudar bonificação</Button>
        <Button
          variant="ghost" className="min-h-10 px-3 text-sm text-red-300" disabled={busy}
          onClick={() => { if (confirm("Tirar a bonificação deste fornecedor?")) run(() => api(url, { method: "DELETE" })); }}
        >
          Tirar
        </Button>
        <FormError message={error} />
      </div>
    );
  }
  return (
    <form
      className="grid gap-3 sm:grid-cols-[10rem_10rem_1fr]"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const ok = await run(() => api(url, { method: "PUT", body: { kind, value: String(f.get("value") ?? ""), notes: String(f.get("notes") ?? "") } }));
        if (ok) setOpen(false);
      }}
    >
      <label className="block">
        <Label>Tipo</Label>
        <Select value={kind} onChange={(e) => setKind(e.target.value as BonusData["kind"])}>
          <option value="PERCENTUAL">Percentual (%)</option>
          <option value="VALOR">Valor (R$)</option>
        </Select>
      </label>
      <label className="block">
        <Label>{kind === "PERCENTUAL" ? "Percentual" : "Valor (R$)"}</Label>
        <Input name="value" inputMode="decimal" required defaultValue={bonus ? String(bonus.value).replace(".", ",") : ""} placeholder={kind === "PERCENTUAL" ? "Ex.: 5" : "Ex.: 2.000,00"} />
      </label>
      <label className="block">
        <Label hint="(opcional)">Regra</Label>
        <Input name="notes" maxLength={500} defaultValue={bonus?.notes ?? ""} placeholder="Ex.: acima de R$ 50 mil no ano, paga em março" />
      </label>
      <div className="sm:col-span-3"><FormError message={error} /></div>
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" disabled={busy}>Salvar bonificação</Button>
        {bonus && <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>}
      </div>
    </form>
  );
}
