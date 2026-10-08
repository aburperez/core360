"use client";

import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { getCostSheet, importCostSheet } from "@/modules/costs/costs.service";
import type { listReceiverOptions } from "@/modules/receipts/receipts.service";
import { BILLING_LABEL, lineSubtotal, type CostBilling } from "@/modules/costs/totals";
import { brl, decimal, parseDecimal } from "@/lib/money";
import { Button, Card, buttonClass, cx } from "@/components/ui";
import { FormError, Input, Label, Select, Textarea } from "@/components/field";
import { api } from "@/components/api-client";
import { ITEM_STATUS_LABEL } from "@/modules/items/item-meta";

type Sheet = Awaited<ReturnType<typeof getCostSheet>>;
type Section = Sheet["sections"][number];
type Item = Section["items"][number];
type Preview = Awaited<ReturnType<typeof importCostSheet>>;
type Receiver = Awaited<ReturnType<typeof listReceiverOptions>>[number];

/** Quem recebe no campo: a lista de pessoas e se quem está vendo pode escolher (gerente). */
const Field = createContext<{ canSend: boolean; receivers: Receiver[]; eventId: string }>({ canSend: false, receivers: [], eventId: "" });

const money = (n: number | null) => (n === null ? "A definir" : brl(n));

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

const pct = (n: number) => `${decimal(n)}%`;
const BILLINGS = Object.entries(BILLING_LABEL) as [CostBilling, string][];

/** Tela inteira: ações, seções com itens, totais e cabeçalho do orçamento. */
export function CostsEditor({ eventId, sheet, receivers }: { eventId: string; sheet: Sheet; receivers: Receiver[] }) {
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const empty = sheet.sections.length === 0;

  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" className="min-h-11 text-sm" onClick={() => setImporting(true)}>
        Importar planilha
      </Button>
      <a href={`/api/events/${eventId}/costs/export`} download className={buttonClass("secondary", "min-h-11 text-sm")}>
        Baixar Excel
      </a>
    </div>
  );

  return (
    <Field.Provider value={{ canSend: sheet.can.sendToField, receivers, eventId }}>
    <div className="space-y-4">
      {!empty && actions}
      {importing && <ImportPanel eventId={eventId} current={sheet.itemCount} onClose={() => setImporting(false)} />}
      {!empty && <TotalsCard eventId={eventId} sheet={sheet} />}
      {!empty && <FieldCard eventId={eventId} sheet={sheet} />}
      <HeaderCard eventId={eventId} header={sheet.header} />

      {empty ? (
        !importing && <EmptySheet eventId={eventId} onImport={() => setImporting(true)} />
      ) : (
        <div>
          {sheet.sections.map((s, i) => (
            <SectionBlock
              key={s.id}
              section={s}
              index={i}
              count={sheet.sections.length}
              sections={sheet.sections}
              editing={editing}
              setEditing={setEditing}
            />
          ))}
          <NewSection eventId={eventId} />
        </div>
      )}
    </div>
    </Field.Provider>
  );
}

// ─────────────────────────── Envio para o campo ───────────────────────────

/** Resumo do campo e o botão "Enviar para o campo" (só o gerente envia). */
function FieldCard({ eventId, sheet }: { eventId: string; sheet: Sheet }) {
  const { canSend } = useContext(Field);
  const f = sheet.field;
  const { busy, error, run } = useAction();
  const [done, setDone] = useState<string | null>(null);
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-muted">No campo</p>
          <p className="mt-1 text-sm">
            {f.sent === 0
              ? `${f.withReceiver} de ${sheet.itemCount} itens com quem recebe. Nada enviado ainda.`
              : <>
                  {f.sent} enviados: <span className="text-emerald-300">{f.ok} chegaram certo</span>
                  {" · "}<span className={f.different ? "text-amber-300" : undefined}>{f.different} diferentes</span>
                  {" · "}{f.pending} aguardando
                </>}
          </p>
          {f.outdated && f.sent > 0 && <p className="mt-1 text-sm text-amber-300">Há mudanças que ainda não foram para o campo.</p>}
          {!canSend && <p className="mt-1 text-xs text-muted">O gerente escolhe quem recebe cada item e envia para o campo. O campo não vê valores.</p>}
        </div>
        {canSend && (
          <Button
            className="min-h-11 text-sm"
            disabled={busy || f.withReceiver === 0 && f.sent === 0}
            onClick={async () => {
              setDone(null);
              const msg = f.withReceiver === 0
                ? "Nenhum item tem quem recebe. Enviar assim tira do campo os itens já enviados. Continuar?"
                : `Enviar para o campo os ${f.withReceiver} itens com quem recebe? O campo vê nome, descritivo e quantidade, sem valores.`;
              if (!confirm(msg)) return;
              await run(async () => {
                const r = await api<{ created: number; updated: number; removed: number; unchanged: number }>(`/api/events/${eventId}/costs/send-to-field`, { body: {} });
                setDone(`Enviado: ${r.created} novos, ${r.updated} atualizados${r.removed ? `, ${r.removed} retirados` : ""}.`);
              });
            }}
          >
            {busy ? "Enviando…" : "Enviar para o campo"}
          </Button>
        )}
      </div>
      {done && <p className="mt-2 text-sm text-emerald-300">{done}</p>}
      <div className="mt-2"><FormError message={error} /></div>
    </Card>
  );
}

const RECEIPT_LABEL = {
  PENDENTE: { label: "Aguardando", tone: "text-muted" },
  OK: { label: "✓ Chegou certo", tone: "text-emerald-300" },
  DIFERENTE: { label: "⚠ Chegou diferente", tone: "text-amber-300" },
} as const;

/** "Recebe: Fulano · ✓ Chegou certo" embaixo do item. */
function FieldLine({ item }: { item: Item }) {
  if (!item.receiverName && !item.receipt) return null;
  const r = item.receipt;
  return (
    <p className="mt-1 text-xs">
      {item.receiverName && <span className="text-muted">Recebe: <span className="text-foreground">{item.receiverName}</span></span>}
      {r && !r.stale && (
        <span className={cx("ml-2", RECEIPT_LABEL[r.status].tone)}>
          {RECEIPT_LABEL[r.status].label}
          {r.status === "DIFERENTE" && r.receivedQuantity !== null && ` (chegou ${decimal(r.receivedQuantity)} de ${decimal(item.quantity)})`}
        </span>
      )}
      {(r?.stale || (item.receiverId && !r)) && <span className="ml-2 text-amber-300">Falta enviar</span>}
      {r?.status === "DIFERENTE" && !r.stale && (
        <span className="mt-0.5 block text-amber-200/90">
          {r.receivedDescription ? `Chegou: ${r.receivedDescription}. ` : ""}&ldquo;{r.note}&rdquo;
          {r.photoIds.map((id, k) => (
            <a key={id} href={`/api/receipt-photos/${id}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="ml-2 font-semibold text-primary">
              Foto {k + 1}
            </a>
          ))}
        </span>
      )}
    </p>
  );
}

function ReceiverSelect({ name, defaultValue, className }: { name: string; defaultValue: string | null; className?: string }) {
  const { receivers } = useContext(Field);
  return (
    <Select name={name} defaultValue={defaultValue ?? ""} className={className}>
      <option value="">Ninguém (não vai para o campo)</option>
      {receivers.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}{p.team ? ` · ${p.team.name}` : p.area ? ` · ${p.area.name}` : ""}
        </option>
      ))}
    </Select>
  );
}

function EmptySheet({ eventId, onImport }: { eventId: string; onImport: () => void }) {
  const { busy, error, run } = useAction();
  return (
    <Card className="text-center">
      <p className="font-semibold">Nenhum custo ainda</p>
      <p className="mt-1 text-sm text-muted">
        Importe a matriz de orçamento em Excel ou comece com as seções dela e preencha aqui.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Button className="min-h-11 text-sm" onClick={onImport}>Importar planilha</Button>
        <Button variant="secondary" className="min-h-11 text-sm" disabled={busy} onClick={() => run(() => api(`/api/events/${eventId}/costs/template`, { body: {} }))}>
          Começar com as seções da matriz
        </Button>
      </div>
      <div className="mt-3"><FormError message={error} /></div>
      <div className="mt-2 text-left"><NewSection eventId={eventId} /></div>
    </Card>
  );
}

// ─────────────────────────────── Importar ───────────────────────────────

function ImportPanel({ eventId, current, onClose }: { eventId: string; current: number; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const { busy, error, setError, run } = useAction();

  const send = (f: File, confirm: boolean) => {
    const form = new FormData();
    form.set("file", f);
    if (confirm) form.set("confirm", "1");
    return api<Preview>(`/api/events/${eventId}/costs/import`, { body: form });
  };

  const choose = async (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setPreview(null);
    setError(null);
    await run(async () => setPreview(await send(f, false)));
  };

  return (
    <Card className="border-primary/50">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">Importar a matriz de orçamento</p>
          <p className="mt-1 text-sm text-muted">Arquivo .xlsx no modelo da matriz. Primeiro você vê a prévia; nada muda até confirmar.</p>
        </div>
        <button type="button" onClick={onClose} className="-mr-1 -mt-1 rounded-lg px-2 py-1 text-xl text-muted hover:text-foreground" aria-label="Fechar">×</button>
      </div>

      <input
        ref={input}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        onChange={(e) => choose(e.target.files?.[0])}
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="secondary" className="min-h-11 text-sm" disabled={busy} onClick={() => input.current?.click()}>
          {file ? "Escolher outro arquivo" : "Escolher arquivo"}
        </Button>
        {file && <span className="min-w-0 truncate text-sm text-muted">{file.name}</span>}
      </div>
      {busy && !preview && <p className="mt-3 text-sm text-muted">Lendo a planilha…</p>}
      <div className="mt-3"><FormError message={error} /></div>

      {preview && file && (
        <div className="mt-2 space-y-3">
          <p className="text-sm">
            <strong>{preview.sections.length} seções</strong> e <strong>{preview.itemCount} itens</strong>
            {preview.optionalCount ? ` (${preview.optionalCount} opcionais, fora do total)` : ""}.
          </p>
          {preview.matchesExcel === true && (
            <p className="rounded-xl bg-emerald-500/15 px-3 py-2 text-sm text-emerald-200">
              ✓ O total bate com o Excel: <strong>{brl(preview.totals.total)}</strong>
            </p>
          )}
          {preview.matchesExcel === false && (
            <p className="rounded-xl bg-amber-400/15 px-3 py-2 text-sm text-amber-200">
              O Excel mostrava {brl(preview.excelTotals.total ?? 0)}; o app calculou <strong>{brl(preview.totals.total)}</strong>. Veja os avisos abaixo.
            </p>
          )}
          {preview.matchesExcel === null && (
            <p className="text-sm">Total calculado: <strong>{brl(preview.totals.total)}</strong></p>
          )}
          <ul className="divide-y divide-border rounded-xl border border-border text-sm">
            {preview.sections.map((s, i) => (
              <li key={i} className="flex justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate">{i + 1}. {s.name} <span className="text-muted">· {s.count}</span></span>
                <span className="shrink-0 tabular-nums">{brl(s.total)}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">
            Honorários {pct(preview.rates.feePct)} · encargos da fatura {pct(preview.rates.invoiceTaxPct)} · encargos da NF {pct(preview.rates.nfTaxPct)}
          </p>
          {preview.warnings.length > 0 && (
            <details className="rounded-xl bg-amber-400/10 px-3 py-2 text-sm">
              <summary className="cursor-pointer font-semibold text-amber-200">{preview.warnings.length + preview.moreWarnings} avisos</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-100/90">
                {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </details>
          )}
          {current > 0 && (
            <p className="rounded-xl bg-red-500/15 px-3 py-2 text-sm text-red-200">
              Isto substitui os {current} itens que já estão na planilha.
              {preview.sentToField > 0 && (preview.canReplaceSent
                ? ` ${preview.sentToField} deles já foram enviados para o campo; as conferências deles serão apagadas.`
                : ` ${preview.sentToField} deles já foram enviados para o campo, então só o gerente pode importar por cima.`)}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || (preview.sentToField > 0 && !preview.canReplaceSent)}
              onClick={async () => {
                if (await run(() => send(file, true))) onClose();
              }}
            >
              {busy ? "Importando…" : "Importar"}
            </Button>
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────── Totais ───────────────────────────────

function TotalsCard({ eventId, sheet }: { eventId: string; sheet: Sheet }) {
  const [edit, setEdit] = useState(false);
  const t = sheet.totals;
  const r = sheet.rates;
  const rows: [string, number, "strong" | "sub" | null][] = [
    ["Subtotal fornecedores", t.suppliers, null],
    [`Honorários (${pct(r.feePct)})`, t.fee, null],
    ["Faturamento direto", t.direct, "sub"],
    ["Subtotal fatura", t.invoice, "sub"],
    [`Encargos da fatura (${pct(r.invoiceTaxPct)})`, t.invoiceTax, "sub"],
    ["Total fatura", t.invoiceTotal, "strong"],
    ["Subtotal nota fiscal", t.nf, "sub"],
    ["Honorários", t.fee, "sub"],
    [`Encargos da NF (${pct(r.nfTaxPct)})`, t.nfTax, "sub"],
    ["Total nota fiscal", t.nfTotal, "strong"],
  ];
  const highlights: [string, number][] = [
    ["Fornecedores", t.suppliers],
    [`Honorários (${pct(r.feePct)})`, t.fee],
    ["Total fatura", t.invoiceTotal],
    ["Total nota fiscal", t.nfTotal],
  ];

  return (
    <Card>
      <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
        <div>
          <p className="text-sm text-muted">Total geral</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{brl(t.total)}</p>
        </div>
        <dl className="grid w-full grid-cols-2 gap-x-6 gap-y-3 text-sm sm:w-auto sm:min-w-0 sm:flex-1 sm:grid-cols-4">
          {highlights.map(([label, value]) => (
            <div key={label}>
              <dt className="text-muted">{label}</dt>
              <dd className="font-semibold tabular-nums">{brl(value)}</dd>
            </div>
          ))}
        </dl>
      </div>
      <details className="mt-3 border-t border-border pt-3">
        <summary className="cursor-pointer text-sm font-semibold text-primary">Ver todas as contas</summary>
        <dl className="mt-3 max-w-md space-y-1.5 text-sm">
          {rows.map(([label, value, kind]) => (
            <div key={label} className={cx("flex justify-between gap-3", kind === "strong" && "border-t border-border pt-1.5 font-semibold", kind === "sub" && "text-muted")}>
              <dt>{label}</dt>
              <dd className="tabular-nums">{brl(value)}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-3 border-t border-border pt-1.5 font-semibold">
            <dt>Total geral</dt>
            <dd className="tabular-nums">{brl(t.total)}</dd>
          </div>
          {t.optional > 0 && (
            <div className="flex justify-between gap-3 pt-1.5 text-xs text-muted">
              <dt>Opcionais (fora do total)</dt>
              <dd className="tabular-nums">{brl(t.optional)}</dd>
            </div>
          )}
          {t.undefinedCount > 0 && (
            <div className="flex justify-between gap-3 pt-1.5 text-xs text-amber-300">
              <dt>Itens a definir (fora do total)</dt>
              <dd className="tabular-nums">{t.undefinedCount}</dd>
            </div>
          )}
        </dl>
        <div className="mt-3 max-w-md">
          {edit ? <RatesForm eventId={eventId} rates={r} onDone={() => setEdit(false)} /> : (
            <button type="button" className="text-sm font-semibold text-primary" onClick={() => setEdit(true)}>Mudar percentuais</button>
          )}
        </div>
      </details>
    </Card>
  );
}

function RatesForm({ eventId, rates, onDone }: { eventId: string; rates: Sheet["rates"]; onDone: () => void }) {
  const { busy, error, setError, run } = useAction();
  const fields = [
    { name: "feePct", label: "Honorários", value: rates.feePct },
    { name: "invoiceTaxPct", label: "Encargos da fatura", value: rates.invoiceTaxPct },
    { name: "nfTaxPct", label: "Encargos da NF", value: rates.nfTaxPct },
  ] as const;
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const body: Record<string, number> = {};
        for (const { name, label } of fields) {
          const n = parseDecimal(String(f.get(name) ?? ""));
          if (n === null) return setError(`Percentual inválido em ${label}`);
          body[name] = n;
        }
        if (await run(() => api(`/api/events/${eventId}/costs`, { method: "PATCH", body }))) onDone();
      }}
    >
      <div className="grid grid-cols-3 gap-2">
        {fields.map((f) => (
          <label key={f.name} className="block">
            <span className="mb-1 block text-xs text-muted">{f.label} (%)</span>
            <Input name={f.name} inputMode="decimal" defaultValue={decimal(f.value)} className="min-h-11 px-2 text-right tabular-nums" />
          </label>
        ))}
      </div>
      <FormError message={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy} className="min-h-11 flex-1 text-sm">Salvar</Button>
        <Button type="button" variant="secondary" className="min-h-11 text-sm" onClick={onDone}>Cancelar</Button>
      </div>
    </form>
  );
}

// ─────────────────────────────── Cabeçalho ───────────────────────────────

const HEADER_FIELDS = [
  { name: "title", label: "Título" },
  { name: "clientName", label: "Cliente" },
  { name: "projectName", label: "Projeto" },
  { name: "period", label: "Período" },
  { name: "clientPaymentTerms", label: "Prazo de pagamento do cliente" },
  { name: "author", label: "Autor" },
] as const;

function HeaderCard({ eventId, header }: { eventId: string; header: Sheet["header"] }) {
  const [edit, setEdit] = useState(false);
  const { busy, error, run } = useAction();
  const filled = HEADER_FIELDS.filter((f) => header[f.name]);
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-muted">Cabeçalho do orçamento</p>
        {!edit && <button type="button" className="text-sm font-semibold text-primary" onClick={() => setEdit(true)}>Editar</button>}
      </div>
      {edit ? (
        <form
          className="mt-3 grid gap-3 lg:grid-cols-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const body = Object.fromEntries(HEADER_FIELDS.map(({ name }) => [name, String(f.get(name) ?? "")]));
            if (await run(() => api(`/api/events/${eventId}/costs`, { method: "PATCH", body }))) setEdit(false);
          }}
        >
          {HEADER_FIELDS.map((f) => (
            <label key={f.name} className="block">
              <Label>{f.label}</Label>
              <Input name={f.name} defaultValue={header[f.name] ?? ""} maxLength={200} className="min-h-11" />
            </label>
          ))}
          <div className="lg:col-span-3"><FormError message={error} /></div>
          <div className="flex gap-2 lg:col-span-3">
            <Button type="submit" disabled={busy} className="min-h-11 text-sm">Salvar</Button>
            <Button type="button" variant="secondary" className="min-h-11 text-sm" onClick={() => setEdit(false)}>Cancelar</Button>
          </div>
        </form>
      ) : filled.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Cliente, projeto, período e prazo de pagamento vão no topo do Excel.</p>
      ) : (
        <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {filled.map((f) => (
            <div key={f.name}>
              <dt className="inline text-muted">{f.label}: </dt>
              <dd className="inline">{header[f.name]}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

// ─────────────────────────────── Seções ───────────────────────────────

function NewSection({ eventId }: { eventId: string }) {
  const [open, setOpen] = useState(false);
  const { busy, error, run } = useAction();
  if (!open) {
    return (
      <button type="button" className="mt-6 text-sm font-semibold text-primary" onClick={() => setOpen(true)}>
        + Nova seção
      </button>
    );
  }
  return (
    <form
      className="mt-6 flex flex-wrap items-start gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const name = String(new FormData(e.currentTarget).get("name") ?? "");
        if (await run(() => api(`/api/events/${eventId}/costs/sections`, { body: { name } }))) setOpen(false);
      }}
    >
      <Input name="name" required maxLength={120} placeholder="Ex.: Transporte" autoFocus aria-label="Nome da seção" className="min-h-11 max-w-xs flex-1" />
      <Button type="submit" disabled={busy} className="min-h-11 text-sm">Criar seção</Button>
      <Button type="button" variant="secondary" className="min-h-11 text-sm" onClick={() => setOpen(false)}>Cancelar</Button>
      <div className="w-full"><FormError message={error} /></div>
    </form>
  );
}

function SectionBlock({ section, index, count, sections, editing, setEditing }: {
  section: Section; index: number; count: number; sections: Section[];
  editing: string | null; setEditing: (id: string | null) => void;
}) {
  const [rename, setRename] = useState(false);
  const [pick, setPick] = useState(false);
  const { canSend } = useContext(Field);
  const { busy, error, run } = useAction();
  const n = index + 1;
  const patch = (body: object) => run(() => api(`/api/cost-sections/${section.id}`, { method: "PATCH", body }));
  const newKey = `new:${section.id}`;
  const form = (item?: Item) => (
    <ItemForm
      section={section}
      sections={sections}
      item={item}
      onDone={() => setEditing(null)}
    />
  );

  return (
    <section className={cx(index > 0 && "mt-6")} aria-label={section.name}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-t-2xl border border-b-0 border-border bg-white/5 px-4 py-2.5">
        {rename ? (
          <form
            className="flex flex-1 flex-wrap gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const name = String(new FormData(e.currentTarget).get("name") ?? "");
              if (await patch({ name })) setRename(false);
            }}
          >
            <Input name="name" defaultValue={section.name} required maxLength={120} autoFocus aria-label="Nome da seção" className="min-h-10 max-w-sm flex-1" />
            <Button type="submit" disabled={busy} className="min-h-10 text-sm">Salvar</Button>
            <Button type="button" variant="secondary" className="min-h-10 text-sm" onClick={() => setRename(false)}>Cancelar</Button>
          </form>
        ) : (
          <>
            <h2 className="min-w-0 flex-1 font-semibold uppercase tracking-wide">
              <span className="mr-2 text-muted">{n}</span>{section.name}
            </h2>
            <span className="font-semibold tabular-nums">{brl(section.total)}</span>
            <details className="relative">
              <summary className="cursor-pointer list-none rounded-lg px-2 text-xl leading-none text-muted hover:text-foreground" aria-label="Opções da seção">⋯</summary>
              <div className="absolute right-0 z-10 mt-1 w-44 rounded-xl border border-border bg-surface p-1 text-sm shadow-lg">
                <MenuButton onClick={() => setRename(true)}>Renomear</MenuButton>
                {canSend && <MenuButton onClick={() => setPick(true)}>Quem recebe a seção</MenuButton>}
                {index > 0 && <MenuButton onClick={() => patch({ move: "up" })}>Subir</MenuButton>}
                {index < count - 1 && <MenuButton onClick={() => patch({ move: "down" })}>Descer</MenuButton>}
                <MenuButton
                  danger
                  onClick={async () => {
                    const msg = section.items.length
                      ? `Apagar a seção "${section.name}" e os ${section.items.length} itens dela?`
                      : `Apagar a seção "${section.name}"?`;
                    if (confirm(msg)) await run(() => api(`/api/cost-sections/${section.id}`, { method: "DELETE" }));
                  }}
                >
                  Apagar seção
                </MenuButton>
              </div>
            </details>
          </>
        )}
      </div>
      {pick && (
        <form
          className="flex flex-wrap items-center gap-2 border-x border-t border-border bg-white/5 px-4 py-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const participantId = String(new FormData(e.currentTarget).get("receiver") ?? "") || null;
            if (await run(() => api(`/api/cost-sections/${section.id}/receiver`, { method: "PUT", body: { participantId } }))) setPick(false);
          }}
        >
          <span className="text-sm text-muted">Quem recebe todos os itens desta seção:</span>
          <ReceiverSelect name="receiver" defaultValue={null} className="min-h-10 w-auto flex-1 py-0 text-sm" />
          <Button type="submit" disabled={busy} className="min-h-10 text-sm">Aplicar</Button>
          <Button type="button" variant="secondary" className="min-h-10 text-sm" onClick={() => setPick(false)}>Cancelar</Button>
        </form>
      )}
      {error && <div className="border-x border-border px-4 py-2"><FormError message={error} /></div>}

      {/* Tela larga: tabela no formato da matriz. */}
      <div className="hidden overflow-hidden border border-border bg-surface xl:block">
        <table className="w-full table-fixed text-left text-sm">
          <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="w-12 px-3 py-2 font-semibold">#</th>
              <th className="px-3 py-2 font-semibold">Item</th>
              <th className="w-20 px-3 py-2 font-semibold">Prazo</th>
              <th className="w-32 px-3 py-2 text-right font-semibold">Unitário</th>
              <th className="w-14 px-3 py-2 text-right font-semibold">Qtd</th>
              <th className="w-14 px-3 py-2 text-right font-semibold">Freq</th>
              <th className="w-36 px-3 py-2 text-right font-semibold">Subtotal</th>
              <th className="w-24 px-3 py-2 font-semibold">Fatur.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {section.items.map((it, i) => (
              editing === it.id ? (
                <tr key={it.id}><td colSpan={8} className="bg-white/5 p-4">{form(it)}</td></tr>
              ) : (
                <tr key={it.id} onClick={() => setEditing(it.id)} className={cx("cursor-pointer align-top transition hover:bg-white/5", it.optional && "text-muted")}>
                  <td className="px-3 py-2.5 tabular-nums text-muted">{n}.{i + 1}</td>
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-foreground">
                      {it.name}
                      {it.optional && <OptionalBadge />}
                    </p>
                    {it.description && <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-xs text-muted">{it.description}</p>}
                    <CodeLine item={it} />
                    <FieldLine item={it} />
                  </td>
                  <td className="px-3 py-2.5 text-muted">{it.paymentTerms ?? "—"}</td>
                  <td className={cx("px-3 py-2.5 text-right tabular-nums", it.unitValue === null && "text-amber-300")}>{money(it.unitValue)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{decimal(it.quantity)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{it.frequency === null ? "—" : decimal(it.frequency)}</td>
                  <td className={cx("px-3 py-2.5 text-right font-semibold tabular-nums", it.optional && "line-through decoration-1")}>{it.subtotal === null ? "—" : brl(it.subtotal)}</td>
                  <td className="px-3 py-2.5 text-xs text-muted">{BILLING_LABEL[it.billing]}</td>
                </tr>
              )
            ))}
            {section.items.length === 0 && editing !== newKey && (
              <tr><td colSpan={8} className="px-3 py-3 text-sm text-muted">Nenhum item nesta seção.</td></tr>
            )}
            {editing === newKey && <tr><td colSpan={8} className="bg-white/5 p-4">{form()}</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Celular e telas menores: cartões. */}
      <ul className="divide-y divide-border border border-border bg-surface xl:hidden">
        {section.items.map((it, i) => (
          <li key={it.id}>
            {editing === it.id ? (
              <div className="bg-white/5 p-4">{form(it)}</div>
            ) : (
              <button type="button" onClick={() => setEditing(it.id)} className="block w-full px-4 py-3 text-left active:bg-white/5">
                <div className="flex items-start justify-between gap-3">
                  <p className={cx("min-w-0 font-medium", it.optional && "text-muted")}>
                    <span className="mr-1.5 text-xs tabular-nums text-muted">{n}.{i + 1}</span>
                    {it.name}
                    {it.optional && <OptionalBadge />}
                  </p>
                  <span className={cx("shrink-0 font-semibold tabular-nums", it.optional && "text-muted line-through decoration-1", it.subtotal === null && "text-amber-300")}>{it.subtotal === null ? "A definir" : brl(it.subtotal)}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  {money(it.unitValue)} × {decimal(it.quantity)}{it.frequency !== null ? ` × ${decimal(it.frequency)}` : ""}
                  {" · "}{BILLING_LABEL[it.billing]}{it.paymentTerms ? ` · ${it.paymentTerms}` : ""}
                </p>
                <CodeLine item={it} />
                <FieldLine item={it} />
              </button>
            )}
          </li>
        ))}
        {section.items.length === 0 && editing !== newKey && <li className="px-4 py-3 text-sm text-muted">Nenhum item nesta seção.</li>}
        {editing === newKey && <li className="bg-white/5 p-4">{form()}</li>}
      </ul>

      <div className="rounded-b-2xl border border-t-0 border-border bg-surface px-4 py-2">
        {editing !== newKey && (
          <button type="button" className="min-h-9 text-sm font-semibold text-primary" onClick={() => setEditing(newKey)}>+ Item</button>
        )}
      </div>
    </section>
  );
}

/** Código e status do item (área, responsável e status ficam no Mapa de itens). */
function CodeLine({ item }: { item: Item }) {
  return (
    <p className="mt-0.5 text-xs text-muted">
      <span className="font-mono">{item.code}</span> · {ITEM_STATUS_LABEL[item.status]}
    </p>
  );
}

function OptionalBadge() {
  return <span className="ml-2 rounded-full bg-amber-400/15 px-2 py-0.5 align-middle text-[11px] font-semibold text-amber-300">Opcional</span>;
}

function MenuButton({ children, onClick, danger }: { children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");
        onClick();
      }}
      className={cx("block w-full rounded-lg px-3 py-2 text-left hover:bg-white/5", danger && "text-red-400")}
    >
      {children}
    </button>
  );
}

// ─────────────────────────────── Item ───────────────────────────────

function ItemForm({ section, sections, item, onDone }: { section: Section; sections: Section[]; item?: Item; onDone: () => void }) {
  const { busy, error, setError, run } = useAction();
  const { canSend, eventId } = useContext(Field);
  const [unit, setUnit] = useState(item?.unitValue != null ? decimal(item.unitValue) : "");
  const [qty, setQty] = useState(item ? decimal(item.quantity) : "1");
  const [freq, setFreq] = useState(item?.frequency != null ? decimal(item.frequency) : "1");
  const [optional, setOptional] = useState(item?.optional ?? false);
  // Valor em branco = a definir (fica fora do total até ser preenchido).
  const values = { unitValue: unit.trim() ? parseDecimal(unit) : null, quantity: parseDecimal(qty), frequency: freq.trim() ? parseDecimal(freq) : null };
  const preview = values.quantity !== null
    ? lineSubtotal({ unitValue: values.unitValue, quantity: values.quantity, frequency: values.frequency })
    : null;

  return (
    <form
      className="grid gap-3 lg:grid-cols-6"
      onSubmit={async (e) => {
        e.preventDefault();
        if (unit.trim() && values.unitValue === null) return setError("Valor unitário inválido");
        if (values.quantity === null) return setError("Quantidade inválida");
        if (freq.trim() && values.frequency === null) return setError("Frequência inválida");
        const f = new FormData(e.currentTarget);
        const body = {
          name: f.get("name"),
          description: f.get("description") || null,
          paymentTerms: f.get("paymentTerms") || null,
          billing: f.get("billing"),
          optional,
          ...values,
          ...(item && f.get("sectionId") !== section.id ? { sectionId: f.get("sectionId") } : {}),
        };
        const receiver = canSend ? (String(f.get("receiver") ?? "") || null) : undefined;
        const ok = await run(async () => {
          const saved = item
            ? await api<{ id: string }>(`/api/cost-items/${item.id}`, { method: "PATCH", body })
            : await api<{ id: string }>(`/api/cost-sections/${section.id}/items`, { body });
          if (receiver !== undefined && receiver !== (item?.receiverId ?? null)) {
            await api(`/api/cost-items/${saved.id}/receiver`, { method: "PUT", body: { participantId: receiver } });
          }
        });
        if (ok) onDone();
      }}
    >
      <label className="block lg:col-span-4">
        <Label>Item</Label>
        <Input name="name" required maxLength={200} defaultValue={item?.name} placeholder="Ex.: Painel de LED 5x3m" autoFocus className="min-h-11" />
      </label>
      <label className="block lg:col-span-2">
        <Label>Faturamento</Label>
        <Select name="billing" defaultValue={item?.billing ?? "FATURA"} className="min-h-11">
          {BILLINGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </label>
      <label className="block lg:col-span-6">
        <Label hint="(opcional)">Descritivo</Label>
        <Textarea name="description" maxLength={5000} defaultValue={item?.description ?? ""} className="min-h-20" />
      </label>
      <label className="block lg:col-span-2">
        <Label hint="(vazio = a definir)">Valor unitário (R$)</Label>
        <Input inputMode="decimal" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="0,00" className="min-h-11 text-right tabular-nums" />
      </label>
      <label className="block">
        <Label>Quantidade</Label>
        <Input inputMode="decimal" required value={qty} onChange={(e) => setQty(e.target.value)} className="min-h-11 text-right tabular-nums" />
      </label>
      <label className="block">
        <Label>Frequência</Label>
        <Input inputMode="decimal" value={freq} onChange={(e) => setFreq(e.target.value)} placeholder="—" className="min-h-11 text-right tabular-nums" />
      </label>
      <label className="block lg:col-span-2">
        <Label>Prazo de pagamento</Label>
        <Input name="paymentTerms" list="cost-terms" maxLength={60} defaultValue={item?.paymentTerms ?? "30dd"} className="min-h-11" />
        <datalist id="cost-terms">
          <option value="30dd" />
          <option value="15dd" />
          <option value="A vista" />
        </datalist>
      </label>
      {canSend ? (
        <label className="block lg:col-span-3">
          <Label hint="(vê nome, descritivo e quantidade, sem valores)">Quem recebe no campo</Label>
          <ReceiverSelect name="receiver" defaultValue={item?.receiverId ?? null} className="min-h-11" />
        </label>
      ) : item?.receiverName ? (
        <p className="text-sm lg:col-span-6"><span className="text-muted">Quem recebe no campo:</span> {item.receiverName}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 lg:col-span-6">
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={optional} onChange={(e) => setOptional(e.target.checked)} className="h-5 w-5 accent-[var(--color-primary)]" />
          Opcional (fica fora do total)
        </label>
        {item && sections.length > 1 && (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">Seção</span>
            <Select name="sectionId" defaultValue={section.id} className="min-h-10 w-auto py-0 text-sm">
              {sections.map((s, i) => <option key={s.id} value={s.id}>{i + 1}. {s.name}</option>)}
            </Select>
          </label>
        )}
        <p className="ml-auto text-sm">
          Subtotal <strong className="tabular-nums">{preview === null ? "A definir" : brl(preview)}</strong>
        </p>
      </div>
      <div className="lg:col-span-6"><FormError message={error} /></div>
      <div className="flex flex-wrap gap-2 lg:col-span-6">
        <Button type="submit" disabled={busy} className="min-h-11 text-sm">{busy ? "Salvando…" : item ? "Salvar" : "Adicionar item"}</Button>
        <Button type="button" variant="secondary" className="min-h-11 text-sm" onClick={onDone}>Cancelar</Button>
        {item && (
          <>
            <Button type="button" variant="secondary" className="min-h-11 px-3 text-sm" disabled={busy} aria-label="Subir" onClick={() => run(() => api(`/api/cost-items/${item.id}`, { method: "PATCH", body: { move: "up" } }))}>↑</Button>
            <Button type="button" variant="secondary" className="min-h-11 px-3 text-sm" disabled={busy} aria-label="Descer" onClick={() => run(() => api(`/api/cost-items/${item.id}`, { method: "PATCH", body: { move: "down" } }))}>↓</Button>
            <Link href={`/eventos/${eventId}/pre-producao/itens/${item.id}`} className={buttonClass("secondary", "min-h-11 text-sm")}>
              Área, responsável e status
            </Link>
            <Button
              type="button"
              variant="ghost"
              className="ml-auto min-h-11 text-sm text-red-400"
              disabled={busy}
              onClick={async () => {
                if (!confirm(`Apagar o item "${item.name}"?`)) return;
                if (await run(() => api(`/api/cost-items/${item.id}`, { method: "DELETE" }))) onDone();
              }}
            >
              Apagar
            </Button>
          </>
        )}
      </div>
    </form>
  );
}

