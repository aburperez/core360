"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/components/api-client";
import { FormError, Input, Label, Select } from "@/components/field";
import { Icon } from "@/components/icons";
import { Button, LinkButton, cx } from "@/components/ui";
import { compressPhoto } from "@/components/photo";
import { CATEGORY } from "@/modules/items/item-meta";
import { isPdf, pdfPageCount, preparePlan } from "../../../planta/prepare";

type Options = {
  areas: { id: string; name: string }[];
  areaLocked: boolean;
  suggestedAreaId: string | null;
  sections: { id: string; name: string }[];
  suggestedSectionId: string | null;
  canSaveDocument: boolean;
  enabled: boolean;
  maxBytes: number;
};

const CATEGORIES = ["TECNICA", "AUDIOVISUAL", "ILUMINACAO"] as const;
type Category = (typeof CATEGORIES)[number];

type ReadItem = {
  name: string; category: Category; quantity: number | null; unit: string | null;
  location: string | null; description: string | null; existing: boolean;
};
type Reading = { summary: string | null; notes: string | null; items: ReadItem[]; areaId: string | null; warnings: string[] };
type Row = { on: boolean; name: string; category: Category; quantity: string; unit: string; location: string; description: string; existing: boolean };
type Added = { added: number; sectionName: string; document: "saved" | "duplicate" | "failed" | null; areaId: string | null };

const ACCEPT = ".pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.dwg";
const NEW = "nova";
const qtyText = (n: number | null) => (n === null ? "" : n.toLocaleString("pt-BR", { maximumFractionDigits: 3 }));

/**
 * Prepara a planta para a IA: PDF leve vai inteiro (todas as folhas e a
 * legenda); PDF pesado vira imagem da folha escolhida; foto é reduzida.
 */
async function prepare(file: File, page: number, maxBytes: number): Promise<{ blob: Blob; name: string }> {
  if (isPdf(file)) {
    if (file.size <= maxBytes) return { blob: file, name: file.name };
    const image = await preparePlan(file, page);
    const { blob } = await compressPhoto(new File([image], "planta.jpg", { type: "image/jpeg" }), 3000, 0.85);
    return { blob, name: file.name.replace(/\.pdf$/i, "") + `-folha-${page}.jpg` };
  }
  const { blob } = await compressPhoto(file, 3000, 0.85);
  return { blob, name: blob === file ? file.name : file.name.replace(/\.[^.]+$/, "") + ".jpg" };
}

export function PlanReader({ eventId, options }: { eventId: string; options: Options }) {
  const router = useRouter();
  const [areaId, setAreaId] = useState(options.suggestedAreaId ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [sent, setSent] = useState<{ blob: Blob; name: string } | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [section, setSection] = useState(options.suggestedSectionId ?? NEW);
  const [newSection, setNewSection] = useState("Técnica");
  const [saveDoc, setSaveDoc] = useState(options.canSaveDocument);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Added | null>(null);

  const dwg = !!file && /\.dwg$/i.test(file.name);
  const bigPdf = !!file && isPdf(file) && file.size > options.maxBytes;
  const chosen = rows.filter((r) => r.on);
  const areaName = options.areas.find((a) => a.id === areaId)?.name ?? null;

  const pick = async (f: File | null) => {
    setFile(f);
    setError(null);
    setPages(0);
    setPage(1);
    if (f && isPdf(f) && f.size > options.maxBytes) {
      setPages(await pdfPageCount(f).catch(() => 0));
    }
  };

  const read = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const ready = await prepare(file, page, options.maxBytes);
      const body = new FormData();
      body.set("data", JSON.stringify({ areaId: areaId || null }));
      body.set("file", ready.blob, ready.name);
      const r = await api<Reading>(`/api/events/${eventId}/technical-plan/read`, { body });
      setSent(ready);
      setReading(r);
      setRows(r.items.map((i) => ({
        on: !i.existing, name: i.name, category: i.category, quantity: i.quantity === null ? "" : qtyText(i.quantity),
        unit: i.unit ?? "", location: i.location ?? "", description: i.description ?? "", existing: i.existing,
      })));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const missing = chosen.find((r) => !r.name.trim() || !r.quantity.trim());
    if (missing) {
      setError(`Preencha o nome e a quantidade de cada item marcado${missing.name.trim() ? ` (falta em "${missing.name.trim()}")` : ""}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("data", JSON.stringify({
        areaId: areaId || null,
        sectionId: section === NEW ? null : section,
        newSection: section === NEW ? newSection : null,
        saveDocument: saveDoc && !!sent,
        items: chosen.map((r) => ({
          name: r.name, category: r.category, quantity: r.quantity, unit: r.unit || null, location: r.location || null, description: r.description || null,
        })),
      }));
      if (saveDoc && sent) body.set("file", sent.blob, sent.name);
      const r = await api<Omit<Added, "areaId">>(`/api/events/${eventId}/technical-plan/items`, { body });
      setAdded({ ...r, areaId: areaId || null });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const restart = () => {
    setFile(null); setPages(0); setPage(1); setSent(null); setReading(null); setRows([]); setAdded(null); setError(null);
  };

  if (added) {
    const items = `/eventos/${eventId}/pre-producao/itens${added.areaId ? `?area=${added.areaId}` : ""}`;
    return (
      <div className="space-y-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4" role="status">
        <p className="font-semibold">
          {added.added} {added.added === 1 ? "item entrou" : "itens entraram"} na seção {added.sectionName}{areaName ? `, área ${areaName}` : ""}, como A definir.
        </p>
        {added.document === "saved" && <p className="text-sm">A planta ficou guardada nos Documentos do evento (categoria Planta).</p>}
        {added.document === "duplicate" && <p className="text-sm">A planta já estava nos Documentos do evento.</p>}
        {added.document === "failed" && <p className="text-sm">Os itens entraram, mas a planta não foi para os Documentos. Envie por lá, se quiser.</p>}
        <div className="flex flex-wrap gap-2">
          <LinkButton href={items}>Ver no Mapa de itens</LinkButton>
          <Button variant="secondary" onClick={restart}>Ler outra planta</Button>
        </div>
      </div>
    );
  }

  if (!reading) {
    return (
      <div className="space-y-3 rounded-2xl border border-primary/40 bg-primary/5 p-4">
        <p className="flex items-center gap-2 font-semibold"><Icon name="sparkles" className="h-4 w-4 text-primary" />Ler a planta com a IA</p>
        {!options.enabled && (
          <p className="rounded-xl border border-amber-400/50 bg-amber-400/10 px-3 py-2 text-sm">
            A leitura pela IA não está ligada neste ambiente. Peça ao administrador para ligar, ou lance os itens à mão na planilha.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <Label hint={options.areaLocked ? "(a sua área)" : "(quem cuida dos itens)"}>Área</Label>
            <Select value={areaId} disabled={options.areaLocked} onChange={(e) => setAreaId(e.target.value)}>
              {!options.areaLocked && <option value="">Sem área (o evento todo)</option>}
              {options.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </label>
          <label className="block">
            <Label hint="(PDF ou foto)">Planta técnica</Label>
            <Input
              type="file" accept={ACCEPT} aria-label="Arquivo da planta técnica"
              onChange={(e) => void pick(e.target.files?.[0] ?? null)}
              className="py-2.5 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1 file:text-foreground"
            />
          </label>
        </div>
        {dwg && (
          <p className="rounded-xl border border-amber-400/50 bg-amber-400/10 px-3 py-2 text-sm">
            Arquivo DWG (AutoCAD): a IA não abre. No AutoCAD, use Exportar ou Plotar em PDF e envie o PDF.
          </p>
        )}
        {bigPdf && (
          <div className="rounded-xl border border-border px-3 py-2 text-sm">
            <p>PDF pesado: a IA vai ler uma folha por vez, como imagem.</p>
            {pages > 1 && (
              <label className="mt-2 flex items-center gap-2">
                Folha
                <Select value={page} onChange={(e) => setPage(Number(e.target.value))} className="w-24">
                  {Array.from({ length: pages }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
                </Select>
                <span className="text-muted">de {pages}</span>
              </label>
            )}
          </div>
        )}
        <Button type="button" disabled={!file || dwg || busy || !options.enabled} onClick={read}>
          {busy ? "Lendo a planta… (até 2 minutos)" : "Ler a planta"}
        </Button>
        <FormError message={error} />
      </div>
    );
  }

  const set = (i: number, patch: Partial<Row>) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const allOn = rows.length > 0 && rows.every((r) => r.on);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-400/50 bg-amber-400/10 p-3 text-sm" role="status">
        <p className="font-semibold">A IA leu {file?.name ?? "a planta"}. Nada foi salvo ainda.</p>
        <p className="mt-0.5">Confira cada linha com a planta, corrija o que precisar e desmarque o que não entra. Os itens só entram quando você tocar em Adicionar.</p>
        {reading.warnings.length > 0 && (
          <ul className="mt-2 list-disc space-y-0.5 pl-5">
            {reading.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        )}
        <button type="button" onClick={restart} className="mt-2 text-primary underline">Descartar a leitura</button>
      </div>

      {(reading.summary || reading.notes) && (
        <div className="rounded-2xl border border-border bg-surface p-4 text-sm">
          {reading.summary && <p><b>O que a planta mostra:</b> {reading.summary}</p>}
          {reading.notes && (
            <>
              <p className="mt-2 font-semibold">Pontos técnicos</p>
              <p className="whitespace-pre-line text-muted">{reading.notes}</p>
            </>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={allOn} onChange={() => setRows((all) => all.map((r) => ({ ...r, on: !allOn })))} className="h-4 w-4 accent-[var(--color-primary)]" />
              Marcar todos
            </label>
            <span className="text-muted">{chosen.length} de {rows.length} marcados</span>
          </div>
          <div className="hidden gap-2 border-b border-border px-3 py-2 text-xs uppercase tracking-wide text-muted lg:grid lg:grid-cols-[1.25rem_2fr_1fr_6rem_5rem_1.3fr_2fr]">
            <span />
            {["Item", "Categoria", "Qtd.", "Un.", "Local", "Especificação"].map((h) => <span key={h}>{h}</span>)}
          </div>
          <ul className="divide-y divide-border">
            {rows.map((r, i) => (
              <li key={i} className={cx("grid gap-2 p-3 lg:grid-cols-[1.25rem_2fr_1fr_6rem_5rem_1.3fr_2fr] lg:items-center", !r.on && "opacity-50")}>
                <div className="flex items-start gap-3 lg:contents">
                  <input
                    type="checkbox" checked={r.on} onChange={() => set(i, { on: !r.on })} aria-label={`Adicionar ${r.name}`}
                    className="mt-3.5 h-5 w-5 shrink-0 accent-[var(--color-primary)] lg:mt-0"
                  />
                  <div className="min-w-0 flex-1">
                    <Input value={r.name} maxLength={200} onChange={(e) => set(i, { name: e.target.value })} aria-label="Item" />
                    {r.existing && <p className="mt-0.5 text-xs text-amber-300">Já está na planilha com este nome</p>}
                  </div>
                </div>
                <div className="grid grid-cols-[1fr_5rem_4.5rem] gap-2 lg:contents">
                  <Select value={r.category} onChange={(e) => set(i, { category: e.target.value as Category })} aria-label="Categoria">
                    {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY[c].label}</option>)}
                  </Select>
                  <Input value={r.quantity} inputMode="decimal" onChange={(e) => set(i, { quantity: e.target.value })} aria-label="Quantidade" placeholder="Qtd."
                    className={cx(r.on && !r.quantity.trim() && "border-amber-400")} />
                  <Input value={r.unit} maxLength={20} onChange={(e) => set(i, { unit: e.target.value })} aria-label="Unidade" placeholder="un" />
                </div>
                <Input value={r.location} maxLength={200} onChange={(e) => set(i, { location: e.target.value })} aria-label="Local" placeholder="Local" />
                <Input value={r.description} maxLength={500} onChange={(e) => set(i, { description: e.target.value })} aria-label="Especificação" placeholder="Especificação" />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-3 rounded-2xl border border-border bg-surface p-4 sm:grid-cols-2">
        <label className="block">
          <Label hint={options.areaLocked ? "(a sua área)" : undefined}>Área dos itens</Label>
          <Select value={areaId} disabled={options.areaLocked} onChange={(e) => setAreaId(e.target.value)}>
            {!options.areaLocked && <option value="">Sem área (o evento todo)</option>}
            {options.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </label>
        <label className="block">
          <Label hint="(da planilha)">Seção</Label>
          <Select value={section} onChange={(e) => setSection(e.target.value)}>
            {options.sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            <option value={NEW}>Nova seção…</option>
          </Select>
        </label>
        {section === NEW && (
          <label className="block sm:col-span-2">
            <Label>Nome da nova seção</Label>
            <Input value={newSection} maxLength={120} onChange={(e) => setNewSection(e.target.value)} />
          </label>
        )}
        {options.canSaveDocument && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={saveDoc} onChange={() => setSaveDoc(!saveDoc)} className="h-4 w-4 accent-[var(--color-primary)]" />
            Guardar a planta nos Documentos do evento
          </label>
        )}
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <Button type="button" disabled={busy || !chosen.length || (section === NEW && !newSection.trim())} onClick={add}>
            {busy ? "Adicionando…" : `Adicionar ${chosen.length} ${chosen.length === 1 ? "item" : "itens"}`}
          </Button>
          <Link href={`/eventos/${eventId}/pre-producao/itens`} className="text-sm text-primary underline">Cancelar</Link>
        </div>
        <FormError message={error} />
      </div>
    </div>
  );
}
