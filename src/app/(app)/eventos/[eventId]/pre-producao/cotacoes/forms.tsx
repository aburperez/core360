"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/components/api-client";
import { FormError, Input, Label, Select, Textarea } from "@/components/field";
import { Icon } from "@/components/icons";
import { Button, Card, cx } from "@/components/ui";
import { brl } from "@/lib/money";
import { DurationInput } from "../sla-forms";

type Option = { id: string; label: string };
type Person = { id: string; name: string; role: string };

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
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, router };
}

const ROLE = { GERENTE: "Gerente", PRE_PRODUTOR: "Pré-produtor" } as Record<string, string>;

function RequestFields({ people, costItems, me, initial }: {
  people: Person[]; costItems: Option[]; me: string | null;
  initial?: { title: string; briefing: string; responsibleId: string; costItemId: string | null };
}) {
  return (
    <>
      <label className="block lg:col-span-2">
        <Label>O que vamos cotar</Label>
        <Input name="title" required maxLength={120} defaultValue={initial?.title} placeholder="Ex.: Gerador para o palco 2" />
      </label>
      <label className="block lg:col-span-2">
        <Label hint="(vai no e-mail para os fornecedores)">Descritivo</Label>
        <Textarea
          name="briefing" required maxLength={5000} rows={6} defaultValue={initial?.briefing}
          placeholder={"Quantidade, especificação, datas e local de entrega, montagem e desmontagem, o que precisa estar incluso."}
        />
      </label>
      <label className="block">
        <Label>Quem cuida</Label>
        <Select name="responsibleId" required defaultValue={initial?.responsibleId ?? me ?? ""}>
          <option value="" disabled>Escolha</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name} · {ROLE[p.role] ?? p.role}</option>)}
        </Select>
      </label>
      <label className="block">
        <Label hint="(opcional)">Item da planilha de custos</Label>
        <Select name="costItemId" defaultValue={initial?.costItemId ?? ""}>
          <option value="">Nenhum</option>
          {costItems.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
        </Select>
      </label>
    </>
  );
}

const readRequest = (f: FormData) => ({
  title: f.get("title"), briefing: f.get("briefing"), responsibleId: f.get("responsibleId"), costItemId: f.get("costItemId") || null,
});

/** "+ Nova cotação": o que cotar, o descritivo, quem cuida e o item da planilha. */
export function NewQuoteForm({ eventId, people, costItems, me }: { eventId: string; people: Person[]; costItems: Option[]; me: string | null }) {
  const [open, setOpen] = useState(false);
  const { busy, error, run, router } = useAction();
  if (!open) {
    return <Button className="min-h-10 w-full px-4 text-sm lg:w-auto" onClick={() => setOpen(true)}><Icon name="plus" className="h-4 w-4" /> Nova cotação</Button>;
  }
  return (
    <Card className="w-full text-left lg:fixed lg:inset-x-0 lg:top-24 lg:z-30 lg:mx-auto lg:max-w-2xl lg:shadow-2xl lg:shadow-black/60">
      <form
        className="grid gap-4 lg:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await run(() => api<{ id: string }>(`/api/events/${eventId}/quotes`, { body: readRequest(new FormData(e.currentTarget)) }));
          if (r && typeof r === "object") router.push(`/eventos/${eventId}/pre-producao/cotacoes/${r.id}`);
        }}
      >
        <p className="text-lg font-semibold lg:col-span-2">Nova cotação</p>
        <RequestFields people={people} costItems={costItems} me={me} />
        <div className="lg:col-span-2"><FormError message={error} /></div>
        <div className="flex gap-2 lg:col-span-2">
          <Button type="submit" disabled={busy}>Criar cotação</Button>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
        </div>
      </form>
    </Card>
  );
}

/** Editar o pedido (antes de fechar). */
export function EditRequestForm({ id, people, costItems, initial }: {
  id: string; people: Person[]; costItems: Option[];
  initial: { title: string; briefing: string; responsibleId: string; costItemId: string | null };
}) {
  const [open, setOpen] = useState(false);
  const { busy, error, run } = useAction();
  if (!open) return <Button variant="ghost" className="min-h-9 px-2 text-sm" onClick={() => setOpen(true)}><Icon name="edit" className="h-4 w-4" /> Editar</Button>;
  return (
    <Card className="mt-3 w-full">
      <form
        className="grid gap-4 lg:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => api(`/api/quote-requests/${id}`, { method: "PATCH", body: readRequest(new FormData(e.currentTarget)) }))) setOpen(false);
        }}
      >
        <RequestFields people={people} costItems={costItems} me={null} initial={initial} />
        <div className="lg:col-span-2"><FormError message={error} /></div>
        <div className="flex gap-2 lg:col-span-2">
          <Button type="submit" disabled={busy}>Salvar</Button>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
        </div>
      </form>
    </Card>
  );
}

/** Copiar o texto pronto ou abrir o e-mail já preenchido. */
export function EmailActions({ subject, text }: { subject: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button" variant="secondary" className="min-h-10 px-4 text-sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(`${subject}\n\n${text}`);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
          } catch {
            setCopied(false);
          }
        }}
      >
        <Icon name="copy" className="h-4 w-4" /> {copied ? "Copiado!" : "Copiar texto"}
      </Button>
      <a href={href} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:brightness-110">
        <Icon name="mail" className="h-4 w-4" /> Abrir no e-mail
      </a>
    </div>
  );
}

/** "Enviei aos fornecedores". O gestor pode já definir o prazo junto. */
export function SendForm({ id, manager }: { id: string; manager: boolean }) {
  const [sla, setSla] = useState<number | null>(null);
  const { busy, error, run } = useAction();
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        await run(() => api(`/api/quote-requests/${id}/send`, { body: { slaMinutes: manager ? sla : null } }));
      }}
    >
      {manager && (
        <label className="block">
          <Label hint="(opcional, pode definir depois)">Prazo para os orçamentos</Label>
          <DurationInput onChange={setSla} />
        </label>
      )}
      <FormError message={error} />
      <Button type="submit" disabled={busy} className="w-full sm:w-auto">Enviei aos fornecedores</Button>
      {!manager && <p className="text-sm text-muted">O gestor recebe um aviso para definir o prazo.</p>}
    </form>
  );
}

/** O gestor define ou muda o prazo (contado a partir de agora). */
export function SlaForm({ id, current }: { id: string; current: number | null }) {
  const [sla, setSla] = useState<number | null>(current);
  const [open, setOpen] = useState(!current);
  const { busy, error, run } = useAction();
  if (!open) return <Button variant="ghost" className="min-h-9 px-2 text-sm" onClick={() => setOpen(true)}>Mudar prazo</Button>;
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (sla && (await run(() => api(`/api/quote-requests/${id}/sla`, { body: { slaMinutes: sla } })))) setOpen(false);
      }}
    >
      <label className="block">
        <Label hint="(a partir de agora)">Prazo para chegarem os orçamentos</Label>
        <DurationInput onChange={setSla} required defaultMinutes={current} />
      </label>
      <FormError message={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !sla}>Definir prazo</Button>
        {current && <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>}
      </div>
    </form>
  );
}

export type QuoteView = {
  id: string; position: number; cnpj: string; companyName: string; phone: string; email: string; contactName: string;
  totalValue: number; paymentTerms: string | null; notes: string | null; fileName: string | null; hasFile: boolean;
};

const cnpjMask = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 14);
  return d.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2");
};

/** Novo orçamento ou correção de um existente, com o arquivo recebido. */
export function QuoteForm({ requestId, quote, onDone }: { requestId: string; quote?: QuoteView; onDone?: () => void }) {
  const [cnpj, setCnpj] = useState(quote ? cnpjMask(quote.cnpj) : "");
  const { busy, error, run } = useAction();
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const body = new FormData();
        body.set("data", JSON.stringify({
          cnpj, companyName: f.get("companyName"), phone: f.get("phone"), email: f.get("email"), contactName: f.get("contactName"),
          totalValue: f.get("totalValue"), paymentTerms: f.get("paymentTerms") || null, notes: f.get("notes") || null,
        }));
        const file = f.get("file");
        if (file instanceof File && file.size > 0) body.set("file", file);
        const ok = await run(() => quote
          ? api(`/api/supplier-quotes/${quote.id}`, { method: "PATCH", body })
          : api(`/api/quote-requests/${requestId}/quotes`, { body }));
        if (ok) onDone?.();
      }}
    >
      <label className="block">
        <Label>CNPJ</Label>
        <Input value={cnpj} onChange={(e) => setCnpj(cnpjMask(e.target.value))} inputMode="numeric" required placeholder="00.000.000/0000-00" />
      </label>
      <label className="block">
        <Label>Razão social</Label>
        <Input name="companyName" required maxLength={160} defaultValue={quote?.companyName} />
      </label>
      <label className="block">
        <Label>Responsável</Label>
        <Input name="contactName" required maxLength={120} defaultValue={quote?.contactName} />
      </label>
      <label className="block">
        <Label>Telefone</Label>
        <Input name="phone" type="tel" required maxLength={30} defaultValue={quote?.phone} placeholder="(11) 98765-4321" />
      </label>
      <label className="block">
        <Label>E-mail</Label>
        <Input name="email" type="email" required maxLength={160} defaultValue={quote?.email} />
      </label>
      <label className="block">
        <Label>Valor total (R$)</Label>
        <Input name="totalValue" inputMode="decimal" required defaultValue={quote ? String(quote.totalValue).replace(".", ",") : ""} placeholder="Ex.: 27.500,00" />
      </label>
      <label className="block">
        <Label hint="(opcional)">Condição de pagamento</Label>
        <Input name="paymentTerms" maxLength={300} defaultValue={quote?.paymentTerms ?? ""} placeholder="Ex.: 30dd após o evento" />
      </label>
      <label className="block">
        <Label hint={quote?.hasFile ? "(envie outro para trocar)" : "(PDF, foto, Excel ou Word, até 10 MB)"}>Arquivo recebido</Label>
        <Input name="file" type="file" accept=".pdf,image/*,.xlsx,.docx" className="py-2.5 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1 file:text-foreground" />
      </label>
      <label className="block sm:col-span-2">
        <Label hint="(opcional)">Observações</Label>
        <Textarea name="notes" maxLength={2000} rows={2} defaultValue={quote?.notes ?? ""} placeholder="Prazo de entrega, o que está incluso, validade da proposta" />
      </label>
      <div className="sm:col-span-2"><FormError message={error} /></div>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={busy}>{quote ? "Salvar" : "Registrar orçamento"}</Button>
        {onDone && <Button type="button" variant="secondary" onClick={onDone}>Cancelar</Button>}
      </div>
    </form>
  );
}

/** Espaço de um orçamento: botão para registrar ou o formulário aberto. */
export function AddQuote({ requestId }: { requestId: string }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button" onClick={() => setOpen(true)}
        className="flex min-h-40 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border text-muted transition hover:border-primary hover:text-primary"
      >
        <Icon name="plus" className="h-7 w-7" />
        <span className="font-semibold">Registrar orçamento</span>
      </button>
    );
  }
  return <Card className="sm:col-span-2 lg:col-span-3"><p className="mb-3 font-semibold">Novo orçamento</p><QuoteForm requestId={requestId} onDone={() => setOpen(false)} /></Card>;
}

/** Editar ou remover um orçamento registrado. */
export function QuoteActions({ quote, requestId }: { quote: QuoteView; requestId: string }) {
  const [editing, setEditing] = useState(false);
  const { busy, error, run } = useAction();
  if (editing) {
    return (
      <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center" role="dialog" aria-label="Editar orçamento">
        <Card className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto">
          <p className="mb-3 font-semibold">Editar orçamento {quote.position}</p>
          <QuoteForm requestId={requestId} quote={quote} onDone={() => setEditing(false)} />
        </Card>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button variant="ghost" className="min-h-9 px-2 text-sm" onClick={() => setEditing(true)}>Editar</Button>
      <Button
        variant="ghost" className="min-h-9 px-2 text-sm text-red-300" disabled={busy}
        onClick={() => { if (confirm(`Remover o orçamento de ${quote.companyName}?`)) run(() => api(`/api/supplier-quotes/${quote.id}`, { method: "DELETE" })); }}
      >
        Remover
      </Button>
      <FormError message={error} />
    </div>
  );
}

/** O gestor escolhe o orçamento: motivo obrigatório quando não é o de menor valor. */
export function ChooseForm({ requestId, quote, lowest, costItem }: {
  requestId: string; quote: { id: string; companyName: string; totalValue: number }; lowest: boolean;
  costItem: { label: string; quantity: number; frequency: number | null } | null;
}) {
  const [open, setOpen] = useState(false);
  const [apply, setApply] = useState(!!costItem);
  const { busy, error, run } = useAction();
  const units = costItem ? costItem.quantity * (costItem.frequency ?? 1) : 0;
  if (!open) {
    return <Button variant={lowest ? "primary" : "secondary"} className="min-h-10 w-full px-3 text-sm" onClick={() => setOpen(true)}>Escolher este</Button>;
  }
  return (
    <form
      className="space-y-3 text-left"
      onSubmit={async (e) => {
        e.preventDefault();
        const reason = new FormData(e.currentTarget).get("reason");
        await run(() => api(`/api/quote-requests/${requestId}/choose`, { body: { quoteId: quote.id, reason: reason || null, applyToCost: apply } }));
      }}
    >
      <label className="block">
        <Label hint={lowest ? "(opcional)" : "(obrigatório: não é o menor valor)"}>Por que este?</Label>
        <Textarea name="reason" rows={2} required={!lowest} maxLength={1000} />
      </label>
      {costItem && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--primary)]" checked={apply} onChange={(e) => setApply(e.target.checked)} disabled={units <= 0} />
          <span>
            Levar o valor para a planilha ({costItem.label})
            {units > 0 && <span className="block text-muted">Valor unitário {brl(Math.round((quote.totalValue / units) * 100) / 100)} × {units} = {brl(quote.totalValue)}</span>}
          </span>
        </label>
      )}
      <FormError message={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy} className="min-h-10 px-3 text-sm">Confirmar</Button>
        <Button type="button" variant="secondary" className="min-h-10 px-3 text-sm" onClick={() => setOpen(false)}>Voltar</Button>
      </div>
    </form>
  );
}

/** Cancelar ou reabrir (gestor). */
export function StateButton({ id, action }: { id: string; action: "CANCELAR" | "REABRIR" }) {
  const { busy, error, run } = useAction();
  return (
    <div>
      <Button
        variant={action === "CANCELAR" ? "ghost" : "secondary"}
        className={cx("min-h-10 px-3 text-sm", action === "CANCELAR" && "text-red-300")}
        disabled={busy}
        onClick={() => {
          if (action === "CANCELAR" && !confirm("Cancelar esta cotação? Ela sai das pendências.")) return;
          run(() => api(`/api/quote-requests/${id}/state`, { body: { action } }));
        }}
      >
        {action === "CANCELAR" ? "Cancelar cotação" : "Reabrir cotação"}
      </Button>
      <FormError message={error} />
    </div>
  );
}
