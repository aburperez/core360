"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/components/api-client";
import { Button, cx } from "@/components/ui";
import { FormError, Input, Label, Textarea } from "@/components/field";
import { brl, decimal, parseDecimal } from "@/lib/money";
import { MISSING_LABEL } from "@/modules/finance/closing";
import type { getFinancialClosing } from "@/modules/finance/closing.service";

type Item = Awaited<ReturnType<typeof getFinancialClosing>>["items"][number];

const money = (v: number | null) => (v === null ? "—" : brl(v));
const dateBr = (iso: string) => iso.split("-").reverse().join("/");

function Diff({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted">—</span>;
  if (value === 0) return <span className="text-muted">{brl(0)}</span>;
  return <span className={value > 0 ? "text-red-300" : "text-emerald-300"}>{value > 0 ? "+" : "−"}{brl(Math.abs(value))}</span>;
}

function Paid({ item }: { item: Item }) {
  if (!item.paidOn) return <span className="font-semibold text-amber-300">A pagar</span>;
  return (
    <span>
      <span className="text-emerald-300">Pago {dateBr(item.paidOn)}</span>
      {item.invoiceNumber && <span className="block text-xs text-muted">NF {item.invoiceNumber}</span>}
    </span>
  );
}

function Missing({ item }: { item: Item }) {
  if (!item.missing.length) return null;
  return <p className="mt-0.5 text-xs text-amber-300">Falta: {item.missing.map((m) => MISSING_LABEL[m]).join(", ")}</p>;
}

/** Itens do fechamento: contratado × realizado, diferença, pagamento e motivo. */
export function PaymentItems({ eventId, items, editable }: { eventId: string; items: Item[]; editable: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const itemHref = (id: string) => `/eventos/${eventId}/pre-producao/itens/${id}`;
  const action = (i: Item) =>
    editable && (
      <Button variant={i.missing.length ? "primary" : "ghost"} className="min-h-9 shrink-0 px-3 text-sm" onClick={() => setEditing(i.id)}>
        {i.paidOn ? "Editar" : "Pagamento"}
      </Button>
    );
  return (
    <section className="rounded-2xl border border-border bg-surface" aria-label="Itens">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Itens ({items.length})</h2>
        <p className="text-xs text-muted">{editable ? "Toque em Pagamento para lançar o realizado, a data e a nota fiscal." : "Financeiro fechado: valores travados."}</p>
      </div>

      {/* Tela larga: tabela. */}
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
            <tr>
              {["Código", "Item", "Contratado", "Realizado", "Diferença", "Pagamento", ""].map((h, k) => (
                <th key={k} scope="col" className={cx("px-3 py-2 font-semibold", k >= 2 && k <= 4 && "text-right")}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((i) =>
              editing === i.id ? (
                <tr key={i.id}><td colSpan={7} className="bg-white/5 p-4"><PaymentForm item={i} onDone={() => setEditing(null)} /></td></tr>
              ) : (
                <tr key={i.id} className="align-top">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs"><Link href={itemHref(i.id)} className="text-primary hover:underline">{i.code}</Link></td>
                  <td className="px-3 py-2">
                    {i.name}
                    {i.overrunReason && <p className="mt-0.5 text-xs text-muted">Motivo do estouro: {i.overrunReason}</p>}
                    <Missing item={i} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(i.contracted)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(i.actual)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums"><Diff value={i.diff} /></td>
                  <td className="whitespace-nowrap px-3 py-2"><Paid item={i} /></td>
                  <td className="px-3 py-1 text-right">{action(i)}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      {/* Celular: cartões. */}
      <ul className="divide-y divide-border lg:hidden">
        {items.map((i) => (
          <li key={i.id} className="px-4 py-3">
            {editing === i.id ? <PaymentForm item={i} onDone={() => setEditing(null)} /> : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={itemHref(i.id)} className="font-mono text-xs text-primary">{i.code}</Link>
                    <p className="font-medium">{i.name}</p>
                  </div>
                  {action(i)}
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <Pair label="Contratado">{money(i.contracted)}</Pair>
                  <Pair label="Realizado">{money(i.actual)}</Pair>
                  <Pair label="Diferença"><Diff value={i.diff} /></Pair>
                  <Pair label="Pagamento"><Paid item={i} /></Pair>
                </dl>
                {i.overrunReason && <p className="mt-1 text-xs text-muted">Motivo do estouro: {i.overrunReason}</p>}
                <Missing item={i} />
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Pair({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right tabular-nums">{children}</dd>
    </div>
  );
}

function PaymentForm({ item, onDone }: { item: Item; onDone: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actual, setActual] = useState(item.actual === null ? "" : decimal(item.actual));
  const typed = actual.trim() ? parseDecimal(actual) : null;
  const overrun = item.contracted !== null && typed !== null && typed > item.contracted;
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const val = (k: string) => String(f.get(k) ?? "").trim() || null;
        setBusy(true);
        setError(null);
        try {
          await api(`/api/cost-items/${item.id}/payment`, {
            method: "PATCH",
            body: { actualValue: actual.trim() || null, paidOn: val("paidOn"), invoiceNumber: val("invoiceNumber"), overrunReason: overrun ? val("overrunReason") : null },
          });
          onDone();
          router.refresh();
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "Não foi possível salvar");
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="font-medium"><span className="font-mono text-xs text-primary">{item.code}</span> {item.name}</p>
      <p className="text-sm text-muted">Contratado: {money(item.contracted)}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <Label hint="(R$, o que foi pago)">Realizado</Label>
          <Input value={actual} onChange={(e) => setActual(e.target.value)} inputMode="decimal" placeholder="0,00" className="text-right tabular-nums" />
        </label>
        <label className="block">
          <Label hint="(vazio = a pagar)">Pago em</Label>
          <Input name="paidOn" type="date" defaultValue={item.paidOn ?? ""} />
        </label>
        <label className="block">
          <Label hint="(opcional)">Nota fiscal</Label>
          <Input name="invoiceNumber" defaultValue={item.invoiceNumber ?? ""} maxLength={60} placeholder="Número da NF" />
        </label>
      </div>
      {overrun && (
        <label className="block">
          <Label hint={`(passou ${brl(typed! - item.contracted!)} do contratado)`}>Motivo do estouro</Label>
          <Textarea name="overrunReason" defaultValue={item.overrunReason ?? ""} maxLength={500} rows={2} required placeholder="Ex.: hora extra da equipe, item a mais pedido pelo cliente" />
        </label>
      )}
      <FormError message={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy} className="min-h-10 px-4 text-sm">{busy ? "Salvando..." : "Salvar"}</Button>
        <Button type="button" variant="secondary" className="min-h-10 px-4 text-sm" onClick={onDone}>Cancelar</Button>
      </div>
    </form>
  );
}

/** Fechar o financeiro: confirma antes, porque os valores travam. */
export function CloseFinancial({ eventId, ready }: { eventId: string; ready: boolean }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!asking) {
    return <Button className="w-full sm:w-auto" disabled={!ready} onClick={() => setAsking(true)}>Fechar o financeiro</Button>;
  }
  return (
    <div className="space-y-2 rounded-xl border border-border bg-black/20 p-3">
      <p className="text-sm">Fechar trava os valores de todos os itens do evento. Para mudar depois, é preciso reabrir com um motivo.</p>
      <FormError message={error} />
      <div className="flex gap-2">
        <Button
          disabled={busy}
          className="min-h-10 px-4 text-sm"
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api(`/api/events/${eventId}/financial`, { method: "POST" });
              router.refresh();
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "Não foi possível fechar");
              setBusy(false);
            }
          }}
        >
          {busy ? "Fechando..." : "Confirmar e fechar"}
        </Button>
        <Button variant="secondary" className="min-h-10 px-4 text-sm" onClick={() => setAsking(false)}>Cancelar</Button>
      </div>
    </div>
  );
}

/** Reabrir pede o motivo (fica no histórico do evento). */
export function ReopenFinancial({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return <Button variant="secondary" className="min-h-10 px-4 text-sm" onClick={() => setOpen(true)}>Reabrir</Button>;
  return (
    <form
      className="w-full space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const reason = String(new FormData(e.currentTarget).get("reason") ?? "").trim();
        setBusy(true);
        setError(null);
        try {
          await api(`/api/events/${eventId}/financial/reopen`, { body: { reason } });
          setOpen(false);
          router.refresh();
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "Não foi possível reabrir");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="block">
        <Label>Por que reabrir?</Label>
        <Textarea name="reason" rows={2} maxLength={500} minLength={5} required placeholder="Ex.: nota fiscal do palco veio com valor errado" />
      </label>
      <FormError message={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy} className="min-h-10 px-4 text-sm">{busy ? "Reabrindo..." : "Reabrir o financeiro"}</Button>
        <Button type="button" variant="secondary" className="min-h-10 px-4 text-sm" onClick={() => setOpen(false)}>Cancelar</Button>
      </div>
    </form>
  );
}
