"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/components/api-client";
import { FormError, Input, Label, Select, Textarea } from "@/components/field";
import { Icon } from "@/components/icons";
import { Button, Card, cx } from "@/components/ui";
import { brl } from "@/lib/money";
import { compressPhoto } from "@/components/photo";
import { DurationInput } from "../sla-forms";
import { ratingText } from "@/modules/suppliers/rating-meta";

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

export type ProposalStatus = "SOLICITADA" | "RECEBIDA" | "EM_NEGOCIACAO" | "APROVADA" | "RECUSADA" | "CANCELADA";

export type QuoteView = {
  id: string; position: number; cnpj: string; companyName: string; phone: string; email: string; contactName: string;
  totalValue: number | null; paymentTerms: string | null; notes: string | null; fileName: string | null; hasFile: boolean;
  status: ProposalStatus; negotiatedValue: number | null; negotiationNote: string | null; value: number | null;
};

const cnpjMask = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 14);
  return d.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2");
};

export type SupplierOption = {
  id: string; cnpj: string; companyName: string; tradeName: string | null; contactName: string | null;
  phone: string | null; email: string | null; suggested: boolean; rating: number | null;
};

const NEW = "novo";

type AiReading = {
  fields: {
    cnpj: string; companyName: string | null; tradeName: string | null; contactName: string | null; phone: string | null;
    email: string | null; totalValue: number | null; paymentTerms: string | null; notes: string | null;
  };
  supplierId: string | null;
  warnings: string[];
};

const AI_ACCEPT = ".pdf,image/jpeg,image/png,image/webp,image/heic,image/heif";
const moneyText = (v: number | null) => (v === null ? "" : v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/**
 * "Ler com a IA": anexa o PDF ou a foto, a IA preenche os campos e quem anexou
 * confere antes de adicionar. Nada é salvo na leitura.
 */
function AiReader({ requestId, onRead }: { requestId: string; onRead: (r: AiReading, file: File) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="rounded-xl border border-primary/40 bg-primary/5 p-3 sm:col-span-2">
      <p className="flex items-center gap-2 font-semibold"><Icon name="sparkles" className="h-4 w-4 text-primary" />Ler o orçamento com a IA</p>
      <p className="mt-0.5 text-sm text-muted">Anexe o PDF ou a foto do orçamento. A IA preenche os campos e você confere antes de adicionar. Excel e Word você preenche à mão.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Input
          type="file" accept={AI_ACCEPT} aria-label="Arquivo do orçamento para a IA ler"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); }}
          className="min-w-0 flex-1 py-2.5 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1 file:text-foreground"
        />
        <Button
          type="button" disabled={!file || busy}
          onClick={async () => {
            if (!file) return;
            setBusy(true);
            setError(null);
            try {
              // Foto: reduz no aparelho (e HEIC vira JPG) para a IA ler rápido.
              const send = file.type.startsWith("image/") ? (await compressPhoto(file, 2400, 0.85)).blob : file;
              const body = new FormData();
              body.set("file", send, file.type.startsWith("image/") && send !== file ? "orcamento.jpg" : file.name);
              onRead(await api<AiReading>(`/api/quote-requests/${requestId}/quotes/read`, { body }), file);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Lendo o arquivo…" : "Ler o arquivo"}
        </Button>
      </div>
      <FormError message={error} />
    </div>
  );
}

/**
 * Novo orçamento ou correção de um existente, com o arquivo recebido. O
 * fornecedor vem do cadastro da agência (os da categoria do item primeiro) ou
 * entra como "Novo fornecedor", que vai para o cadastro junto com o orçamento.
 */
export function QuoteForm({ requestId, quote, suppliers = [], aiReader = false, onDone }: {
  requestId: string; quote?: QuoteView; suppliers?: SupplierOption[]; aiReader?: boolean; onDone?: () => void;
}) {
  const [pick, setPick] = useState<string>(quote ? NEW : suppliers.length ? "" : NEW);
  const [cnpj, setCnpj] = useState(quote ? cnpjMask(quote.cnpj) : "");
  const [reading, setReading] = useState<{ data: AiReading; file: File; key: number } | null>(null);
  // Proposta pedida e ainda sem valor: entra como Solicitada.
  const [pending, setPending] = useState(false);
  const noValueYet = pending || quote?.status === "SOLICITADA";
  const { busy, error, run } = useAction();
  const chosen = suppliers.find((s) => s.id === pick) ?? null;
  const read = reading?.data.fields;
  // Digitou no "Novo fornecedor" um CNPJ que já está no cadastro: usa o do cadastro.
  const known = !quote && pick === NEW ? suppliers.find((s) => s.cnpj === cnpj.replace(/\D/g, "")) ?? null : null;
  const suggested = suppliers.filter((s) => s.suggested);
  const others = suppliers.filter((s) => !s.suggested);
  const label = (s: SupplierOption) =>
    `${s.tradeName ? `${s.tradeName} (${s.companyName})` : s.companyName}${s.rating === null ? "" : ` · nota ${ratingText(s.rating)}`}`;
  // Campos de contato: do orçamento, do que a IA leu, do fornecedor escolhido ou em branco.
  const pre = (k: "contactName" | "phone" | "email") => quote?.[k] ?? read?.[k] ?? chosen?.[k] ?? "";
  const applyReading = (data: AiReading, file: File) => {
    const known = data.supplierId && suppliers.some((s) => s.id === data.supplierId) ? data.supplierId : null;
    setPick(known ?? NEW);
    setCnpj(cnpjMask(data.fields.cnpj));
    setReading({ data, file, key: Date.now() });
  };
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const body = new FormData();
        body.set("data", JSON.stringify({
          cnpj: chosen ? chosen.cnpj : cnpj, companyName: chosen ? chosen.companyName : f.get("companyName"),
          phone: f.get("phone"), email: f.get("email"), contactName: f.get("contactName"),
          totalValue: f.get("totalValue") ?? "", paymentTerms: f.get("paymentTerms") || null, notes: f.get("notes") || null,
        }));
        const file = f.get("file");
        if (file instanceof File && file.size > 0) body.set("file", file);
        else if (reading) body.set("file", reading.file);
        const ok = await run(() => quote
          ? api(`/api/supplier-quotes/${quote.id}`, { method: "PATCH", body })
          : api(`/api/quote-requests/${requestId}/quotes`, { body }));
        if (ok) onDone?.();
      }}
    >
      {!quote && aiReader && !reading && <AiReader requestId={requestId} onRead={applyReading} />}
      {reading && (
        <div className="rounded-xl border border-amber-400/50 bg-amber-400/10 p-3 text-sm sm:col-span-2" role="status">
          <p className="font-semibold">A IA leu {reading.file.name}. Nada foi salvo ainda.</p>
          <p className="mt-0.5">Confira cada campo com o arquivo e corrija o que precisar. O orçamento só entra quando você clicar em Confirmar e adicionar.</p>
          {reading.data.warnings.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5">
              {reading.data.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
          <button type="button" onClick={() => { setReading(null); setPick(suppliers.length ? "" : NEW); setCnpj(""); }} className="mt-2 text-primary underline">
            Descartar a leitura
          </button>
        </div>
      )}
      {!quote && (
        <label className="block sm:col-span-2">
          <Label hint="(do cadastro da agência)">Fornecedor</Label>
          <Select value={pick} required onChange={(e) => setPick(e.target.value)}>
            <option value="" disabled>Escolha o fornecedor</option>
            {suggested.length > 0 && (
              <optgroup label="Sugeridos para a categoria do item">
                {suggested.map((s) => <option key={s.id} value={s.id}>{label(s)}</option>)}
              </optgroup>
            )}
            {others.length > 0 && (
              <optgroup label={suggested.length ? "Outros do cadastro" : "Cadastro da agência"}>
                {others.map((s) => <option key={s.id} value={s.id}>{label(s)}</option>)}
              </optgroup>
            )}
            <option value={NEW}>+ Novo fornecedor</option>
          </Select>
        </label>
      )}
      {chosen ? (
        <div className="rounded-xl border border-border px-3 py-2 sm:col-span-2">
          <p className="font-semibold">{chosen.companyName}</p>
          <p className="text-sm tabular-nums text-muted">CNPJ {cnpjMask(chosen.cnpj)}</p>
        </div>
      ) : (pick === NEW || quote) && (
        <Fragment key={reading?.key ?? 0}>
          {!quote && <p className="text-sm text-muted sm:col-span-2">O fornecedor novo entra no cadastro da agência junto com este orçamento.</p>}
          <label className="block">
            <Label>CNPJ</Label>
            <Input value={cnpj} onChange={(e) => setCnpj(cnpjMask(e.target.value))} inputMode="numeric" required placeholder="00.000.000/0000-00" />
            {known && (
              <button type="button" onClick={() => setPick(known.id)} className="mt-1 text-left text-sm text-primary underline">
                Esse CNPJ já está no cadastro: {known.companyName}. Usar este.
              </button>
            )}
          </label>
          <label className="block">
            <Label>Razão social</Label>
            <Input name="companyName" required maxLength={160} defaultValue={quote?.companyName ?? read?.companyName ?? ""} />
          </label>
        </Fragment>
      )}
      {(pick || quote) && (
        <div key={`${pick}-${reading?.key ?? 0}`} className="contents">
          <label className="block">
            <Label>Responsável</Label>
            <Input name="contactName" required maxLength={120} defaultValue={pre("contactName")} />
          </label>
          <label className="block">
            <Label>Telefone</Label>
            <Input name="phone" type="tel" required maxLength={30} defaultValue={pre("phone")} placeholder="(11) 98765-4321" />
          </label>
          <label className="block">
            <Label>E-mail</Label>
            <Input name="email" type="email" required maxLength={160} defaultValue={pre("email")} />
          </label>
          {!quote && !reading && (
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={pending} onChange={(e) => setPending(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-primary)]" />
              <span>Pedi o orçamento e o valor ainda não chegou <span className="text-muted">(fica como Solicitada)</span></span>
            </label>
          )}
          {!pending && (
            <>
              <label className="block">
                <Label hint={quote?.status === "SOLICITADA" ? "(deixe vazio se ainda não chegou)" : undefined}>Valor total (R$)</Label>
                <Input
                  name="totalValue" inputMode="decimal" required={!noValueYet} placeholder="Ex.: 27.500,00"
                  defaultValue={quote ? (quote.totalValue === null ? "" : String(quote.totalValue).replace(".", ",")) : moneyText(read?.totalValue ?? null)}
                />
              </label>
              <label className="block">
                <Label hint="(opcional)">Condição de pagamento</Label>
                <Input name="paymentTerms" maxLength={300} defaultValue={quote?.paymentTerms ?? read?.paymentTerms ?? ""} placeholder="Ex.: 30dd após o evento" />
              </label>
            </>
          )}
          {pending ? null : reading ? (
            <div className="block">
              <Label>Arquivo recebido</Label>
              <p className="flex min-h-11 items-center gap-2 truncate rounded-xl border border-border px-3 text-sm"><Icon name="paperclip" className="h-4 w-4 shrink-0 text-muted" />{reading.file.name}</p>
            </div>
          ) : (
            <label className="block">
              <Label hint={quote?.hasFile ? "(envie outro para trocar)" : "(PDF, foto, Excel ou Word, até 10 MB)"}>Arquivo recebido</Label>
              <Input name="file" type="file" accept=".pdf,image/*,.xlsx,.docx" className="py-2.5 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1 file:text-foreground" />
            </label>
          )}
          <label className="block sm:col-span-2">
            <Label hint="(opcional)">Observações</Label>
            <Textarea name="notes" maxLength={2000} rows={2} defaultValue={quote?.notes ?? read?.notes ?? ""} placeholder="Prazo de entrega, o que está incluso, validade da proposta" />
          </label>
        </div>
      )}
      {reading && (pick || quote) && (
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" required className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-primary)]" />
          <span>Conferi os dados com o arquivo do orçamento.</span>
        </label>
      )}
      <div className="sm:col-span-2"><FormError message={error} /></div>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={busy || (!pick && !quote)}>{quote ? "Salvar" : reading ? "Confirmar e adicionar" : pending ? "Registrar como Solicitada" : "Registrar orçamento"}</Button>
        {onDone && <Button type="button" variant="secondary" onClick={onDone}>Cancelar</Button>}
      </div>
    </form>
  );
}

/** Espaço de um orçamento: botão para registrar ou o formulário aberto. */
export function AddQuote({ requestId, suppliers, aiReader = false }: { requestId: string; suppliers: SupplierOption[]; aiReader?: boolean }) {
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
  return <Card className="sm:col-span-2 lg:col-span-3"><p className="mb-3 font-semibold">Novo orçamento</p><QuoteForm requestId={requestId} suppliers={suppliers} aiReader={aiReader} onDone={() => setOpen(false)} /></Card>;
}

/** Editar ou remover um orçamento registrado. */
export function QuoteActions({ quote, requestId, manager }: { quote: QuoteView; requestId: string; manager: boolean }) {
  const [editing, setEditing] = useState(false);
  const [negotiating, setNegotiating] = useState(false);
  const { busy, error, run } = useAction();
  const status = (action: "NEGOCIACAO" | "CANCELAR" | "REATIVAR") => run(() => api(`/api/supplier-quotes/${quote.id}/status`, { body: { action } }));
  if (negotiating) return <NegotiateForm quote={quote} onDone={() => setNegotiating(false)} />;
  if (editing) {
    return (
      <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center" role="dialog" aria-label="Editar orçamento">
        <Card className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto">
          <p className="mb-3 font-semibold">{quote.status === "SOLICITADA" ? `Registrar o valor do orçamento ${quote.position}` : `Editar orçamento ${quote.position}`}</p>
          <QuoteForm requestId={requestId} quote={quote} onDone={() => setEditing(false)} />
        </Card>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {manager && quote.totalValue !== null && quote.status !== "CANCELADA" && (
        <Button variant="ghost" className="min-h-9 px-2 text-sm" onClick={() => setNegotiating(true)}>{quote.negotiatedValue === null ? "Negociar valor" : "Mudar negociado"}</Button>
      )}
      {!manager && quote.status === "RECEBIDA" && (
        <Button variant="ghost" className="min-h-9 px-2 text-sm" disabled={busy} onClick={() => status("NEGOCIACAO")}>Em negociação</Button>
      )}
      <Button variant="ghost" className="min-h-9 px-2 text-sm" onClick={() => setEditing(true)}>{quote.status === "SOLICITADA" ? "Registrar valor" : "Editar"}</Button>
      {quote.status === "CANCELADA" ? (
        <Button variant="ghost" className="min-h-9 px-2 text-sm" disabled={busy} onClick={() => status("REATIVAR")}>Reativar</Button>
      ) : (
        <Button
          variant="ghost" className="min-h-9 px-2 text-sm text-amber-300" disabled={busy}
          onClick={() => { if (confirm(`Cancelar a proposta de ${quote.companyName}? Ela sai do comparativo, mas fica registrada.`)) status("CANCELAR"); }}
        >
          Cancelar proposta
        </Button>
      )}
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

/** O diretor registra o valor negociado (o recebido fica guardado). Vazio desfaz. */
function NegotiateForm({ quote, onDone }: { quote: QuoteView; onDone: () => void }) {
  const { busy, error, run } = useAction();
  const save = async (value: string, note: string | null) => {
    if (await run(() => api(`/api/supplier-quotes/${quote.id}/negotiation`, { method: "PUT", body: { value, note } }))) onDone();
  };
  return (
    <form
      className="w-full space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        save(String(f.get("value") ?? ""), (f.get("note") as string) || null);
      }}
    >
      <p className="text-sm text-muted">Valor recebido: {brl(quote.totalValue ?? 0)}. Ele fica guardado.</p>
      <label className="block">
        <Label>Valor negociado (R$)</Label>
        <Input name="value" inputMode="decimal" required defaultValue={quote.negotiatedValue === null ? "" : moneyText(quote.negotiatedValue)} placeholder="Ex.: 25.000,00" />
      </label>
      <label className="block">
        <Label hint="(opcional)">Como foi a negociação</Label>
        <Textarea name="note" rows={2} maxLength={500} defaultValue={quote.negotiationNote ?? ""} placeholder="Ex.: desconto de 7% fechando até sexta" />
      </label>
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy} className="min-h-10 px-3 text-sm">Salvar negociado</Button>
        {quote.negotiatedValue !== null && (
          <Button type="button" variant="ghost" disabled={busy} className="min-h-10 px-3 text-sm" onClick={() => save("", null)}>Desfazer negociação</Button>
        )}
        <Button type="button" variant="secondary" className="min-h-10 px-3 text-sm" onClick={onDone}>Voltar</Button>
      </div>
    </form>
  );
}

/** O gestor escolhe o orçamento: motivo obrigatório quando não é o de menor valor. */
export function ChooseForm({ requestId, quote, lowest, costItem }: {
  requestId: string; quote: { id: string; companyName: string; value: number }; lowest: boolean;
  costItem: { label: string; quantity: number; frequency: number | null } | null;
}) {
  const [open, setOpen] = useState(false);
  const [apply, setApply] = useState(!!costItem);
  const { busy, error, run } = useAction();
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
          <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--primary)]" checked={apply} onChange={(e) => setApply(e.target.checked)} />
          <span>
            {brl(quote.value)} vira o Contratado do item ({costItem.label})
            <span className="block text-muted">O Estimado da planilha fica como está, para comparar. O item passa para Contratado.</span>
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
