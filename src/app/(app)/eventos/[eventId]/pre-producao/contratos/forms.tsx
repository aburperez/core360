"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/components/api-client";
import { FormError, Input, Label, Select, Textarea } from "@/components/field";
import { Button, Card, cx } from "@/components/ui";
import { brl } from "@/lib/money";
import { formatBytes } from "@/lib/documents";

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
  return { busy, error, setError, run, router };
}

const moneyText = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const small = "min-h-9 px-2 text-sm";

/** Cria o rascunho com as propostas aprovadas do fornecedor e abre o contrato. */
export function CreateContract({ eventId, supplierId }: { eventId: string; supplierId: string }) {
  const { busy, error, run, router } = useAction();
  return (
    <div>
      <Button
        className="min-h-10 px-3 text-sm" disabled={busy}
        onClick={async () => {
          const c = await run(() => api<{ id: string }>(`/api/events/${eventId}/contracts`, { body: { supplierId } }));
          if (c && typeof c === "object") router.push(`/eventos/${eventId}/pre-producao/contratos/${c.id}`);
        }}
      >
        Criar contrato
      </Button>
      <FormError message={error} />
    </div>
  );
}

/** Tirar uma proposta do contrato e, para o diretor, mudar o valor dela. */
export function ItemActions({ item, canEdit, canChangeValue }: {
  item: { id: string; value: number; proposalValue: number; name: string }; canEdit: boolean; canChangeValue: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const { busy, error, run } = useAction();
  if (editing) {
    return (
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const value = String(new FormData(e.currentTarget).get("value") ?? "");
          if (await run(() => api(`/api/contract-items/${item.id}`, { method: "PUT", body: { value } }))) setEditing(false);
        }}
      >
        <label className="block">
          <Label>Valor no contrato (R$)</Label>
          <Input name="value" inputMode="decimal" required defaultValue={moneyText(item.value)} className="w-36" />
        </label>
        <Button type="submit" disabled={busy} className="min-h-10 px-3 text-sm">Salvar</Button>
        <Button type="button" variant="secondary" className="min-h-10 px-3 text-sm" onClick={() => setEditing(false)}>Voltar</Button>
        <p className="w-full text-xs text-muted">Valor da proposta: {brl(item.proposalValue)}</p>
        <FormError message={error} />
      </form>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {canChangeValue && <Button variant="ghost" className={small} onClick={() => setEditing(true)}>Mudar valor</Button>}
      {canEdit && (
        <Button
          variant="ghost" className={cx(small, "text-red-300")} disabled={busy}
          onClick={() => { if (confirm(`Tirar "${item.name}" deste contrato? A proposta continua aprovada.`)) run(() => api(`/api/contract-items/${item.id}`, { method: "DELETE" })); }}
        >
          Tirar
        </Button>
      )}
      <FormError message={error} />
    </div>
  );
}

/** Incluir outra proposta aprovada do mesmo fornecedor. */
export function AddItem({ contractId, options }: { contractId: string; options: { quoteId: string; label: string }[] }) {
  const { busy, error, run } = useAction();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const quoteId = String(new FormData(e.currentTarget).get("quoteId") ?? "");
        run(() => api(`/api/contracts/${contractId}/items`, { body: { quoteId } }));
      }}
    >
      <label className="block min-w-0 flex-1">
        <Label>Incluir proposta aprovada deste fornecedor</Label>
        <Select name="quoteId" required>
          {options.map((o) => <option key={o.quoteId} value={o.quoteId}>{o.label}</option>)}
        </Select>
      </label>
      <Button type="submit" disabled={busy} className="min-h-11 px-3 text-sm">Incluir</Button>
      <div className="w-full"><FormError message={error} /></div>
    </form>
  );
}

/** Condição de pagamento, entrega e observações (só no rascunho). */
export function DataForm({ id, initial }: {
  id: string; initial: { paymentTerms: string | null; deliveryNotes: string | null; notes: string | null };
}) {
  const { busy, error, run } = useAction();
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="space-y-3"
      onChange={() => setSaved(false)}
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const text = (k: string) => String(f.get(k) ?? "").trim() || null;
        if (await run(() => api(`/api/contracts/${id}`, { method: "PATCH", body: { paymentTerms: text("paymentTerms"), deliveryNotes: text("deliveryNotes"), notes: text("notes") } }))) setSaved(true);
      }}
    >
      <fieldset className="space-y-3">
        <label className="block">
          <Label>Condição de pagamento</Label>
          <Input name="paymentTerms" maxLength={500} defaultValue={initial.paymentTerms ?? ""} placeholder="Ex.: 50% na assinatura e 50% em 30 dias" />
        </label>
        <label className="block">
          <Label>Entrega e retirada</Label>
          <Textarea name="deliveryNotes" rows={2} maxLength={1000} defaultValue={initial.deliveryNotes ?? ""} placeholder="Ex.: entrega 31/08 às 8h no Portão 4; retirada 03/09" />
        </label>
        <label className="block">
          <Label hint="(opcional)">Observações</Label>
          <Textarea name="notes" rows={2} maxLength={2000} defaultValue={initial.notes ?? ""} />
        </label>
      </fieldset>
      <FormError message={error} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy} className="min-h-10 px-3 text-sm">Salvar dados</Button>
        {saved && <span className="text-sm text-emerald-300">Salvo</span>}
      </div>
    </form>
  );
}

/** Anexar ou trocar o PDF do contrato. Ele também entra em Documentos. */
export function PdfUpload({ id, hasFile, maxBytes }: { id: string; hasFile: boolean; maxBytes: number }) {
  const { busy, error, setError, run } = useAction();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div>
      <input
        ref={input} type="file" accept="application/pdf,.pdf" className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          if (file.size > maxBytes) return setError(`Arquivo maior que ${formatBytes(maxBytes)}`);
          const body = new FormData();
          body.set("file", file);
          await run(() => api(`/api/contracts/${id}/file`, { body }));
        }}
      />
      <Button variant={hasFile ? "secondary" : "primary"} className="min-h-10 px-3 text-sm" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? "Enviando…" : hasFile ? "Trocar o PDF" : "Anexar o PDF"}
      </Button>
      <FormError message={error} />
    </div>
  );
}

type Can = { send: boolean; backToDraft: boolean; sign: boolean; cancel: boolean };

/** Enviar e voltar para rascunho (Pré-produção); assinar e cancelar (diretor). */
export function StatusActions({ id, can, hasFile }: { id: string; can: Can; hasFile: boolean }) {
  const [mode, setMode] = useState<"sign" | "cancel" | null>(null);
  const { busy, error, run } = useAction();
  const go = (body: Record<string, unknown>) => run(() => api(`/api/contracts/${id}/status`, { body }));
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

  if (mode === "sign") {
    return (
      <Card className="space-y-3 border-emerald-500/40">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const signedOn = String(new FormData(e.currentTarget).get("signedOn") ?? "");
            if (await go({ action: "ASSINAR", signedOn })) setMode(null);
          }}
        >
          <p className="font-semibold">Marcar como assinado</p>
          <label className="block">
            <Label>Data da assinatura</Label>
            <Input type="date" name="signedOn" required defaultValue={today} max={today} />
          </label>
          <p className="text-sm text-muted">O valor de cada proposta vira o Contratado do item no Orçamento. Depois de assinado, o contrato não muda mais.</p>
          <FormError message={error} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy} className="min-h-10 px-3 text-sm">Confirmar assinatura</Button>
            <Button type="button" variant="secondary" className="min-h-10 px-3 text-sm" onClick={() => setMode(null)}>Voltar</Button>
          </div>
        </form>
      </Card>
    );
  }
  if (mode === "cancel") {
    return (
      <Card className="space-y-3 border-red-500/40">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const reason = String(new FormData(e.currentTarget).get("reason") ?? "");
            if (await go({ action: "CANCELAR", reason })) setMode(null);
          }}
        >
          <p className="font-semibold">Cancelar o contrato</p>
          <label className="block">
            <Label>Motivo</Label>
            <Textarea name="reason" rows={2} required maxLength={500} />
          </label>
          <p className="text-sm text-muted">As propostas ficam livres para um novo contrato. O Contratado do Orçamento não muda sozinho.</p>
          <FormError message={error} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy} className="min-h-10 bg-red-500/90 px-3 text-sm">Cancelar contrato</Button>
            <Button type="button" variant="secondary" className="min-h-10 px-3 text-sm" onClick={() => setMode(null)}>Voltar</Button>
          </div>
        </form>
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {can.send && <Button className="min-h-10 px-3 text-sm" disabled={busy} onClick={() => go({ action: "ENVIAR" })}>Marcar como enviado</Button>}
        {can.sign && <Button className="min-h-10 px-3 text-sm" disabled={busy || !hasFile} onClick={() => setMode("sign")}>Assinado</Button>}
        {can.backToDraft && <Button variant="secondary" className="min-h-10 px-3 text-sm" disabled={busy} onClick={() => go({ action: "RASCUNHO" })}>Voltar para rascunho</Button>}
        {can.cancel && <Button variant="ghost" className="min-h-10 px-3 text-sm text-red-300" disabled={busy} onClick={() => setMode("cancel")}>Cancelar contrato</Button>}
      </div>
      {can.sign && !hasFile && <p className="text-sm text-amber-300">Anexe o PDF do contrato para marcar como assinado.</p>}
      <FormError message={error} />
    </div>
  );
}
