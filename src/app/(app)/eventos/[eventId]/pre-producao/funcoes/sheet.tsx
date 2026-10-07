"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, buttonClass, cx } from "@/components/ui";
import { FormError } from "@/components/field";
import { Icon } from "@/components/icons";
import { api } from "@/components/api-client";

type Count = { create: number; update: number; createNames: string[]; updateNames: string[] };
type Preview = {
  people?: Count;
  areas: Count;
  teams: Count;
  functions: Count;
  activities: { create: number; update: number };
  ignoredAreas: boolean;
  warnings: string[];
  moreWarnings: number;
  nothing: boolean;
  saved: boolean;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Planilha de funções e áreas: baixar o modelo já preenchido com o evento,
 * mexer no Excel e enviar de volta. Primeiro mostra o que vai mudar; só grava
 * ao confirmar. O envio nunca apaga nada.
 */
export function SheetPanel({ eventId, canEditAreas }: { eventId: string; canEditAreas: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"read" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async (f: File, confirm: boolean) => {
    const form = new FormData();
    form.set("file", f);
    if (confirm) form.set("confirm", "1");
    setBusy(confirm ? "save" : "read");
    setError(null);
    try {
      const p = await api<Preview>(`/api/events/${eventId}/functions/sheet`, { body: form });
      setPreview(p);
      if (p.saved) router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const close = () => {
    setFile(null);
    setPreview(null);
    setError(null);
  };

  const open = !!(file || error);

  return (
    <Card className={cx(open && "border-primary/50")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-semibold">Planilha de funções e áreas</p>
          <p className="mt-0.5 text-sm text-muted">
            {canEditAreas ? "Pessoas (perfil e função), áreas e equipes, funções e atividades" : "A função de cada pessoa, funções e atividades"} no modelo do sistema.
            Baixe, preencha no Excel e envie de volta.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <a href={`/api/events/${eventId}/functions/sheet`} download className={buttonClass("secondary", "min-h-11 flex-1 gap-2 text-sm sm:flex-none")}>
            <Icon name="download" className="h-4 w-4" />
            Baixar planilha
          </a>
          <Button variant="secondary" className="min-h-11 flex-1 gap-2 text-sm sm:flex-none" disabled={!!busy} onClick={() => input.current?.click()}>
            <Icon name="upload" className="h-4 w-4" />
            Enviar planilha
          </Button>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setFile(f);
          setPreview(null);
          void send(f, false);
        }}
      />

      {open && (
        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
          {file && (
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 truncate text-sm text-muted">{file.name}</p>
              <button type="button" onClick={close} className="-mr-1 rounded-lg px-2 py-1 text-xl leading-none text-muted hover:text-foreground" aria-label="Fechar">×</button>
            </div>
          )}
          {busy === "read" && <p className="text-sm text-muted">Lendo a planilha…</p>}
          <FormError message={error} />

          {preview && <PreviewView p={preview} />}

          {preview && !preview.saved && !preview.nothing && file && (
            <div className="flex flex-wrap gap-2">
              <Button disabled={!!busy} onClick={() => send(file, true)}>{busy === "save" ? "Gravando…" : "Confirmar e gravar"}</Button>
              <Button variant="secondary" disabled={!!busy} onClick={close}>Cancelar</Button>
            </div>
          )}
          {preview && (preview.saved || preview.nothing) && (
            <div><Button variant="secondary" onClick={close}>Fechar</Button></div>
          )}
          {error && !preview && <div><Button variant="secondary" onClick={close}>Fechar</Button></div>}
        </div>
      )}
    </Card>
  );
}

function PreviewView({ p }: { p: Preview }) {
  const rows: { label: string; c: { create: number; update: number; createNames?: string[]; updateNames?: string[] }; one: string; many: string; changed?: string }[] = [
    { label: "Pessoas", c: p.people ?? { create: 0, update: 0 }, one: "pessoa", many: "pessoas", changed: "Mudam" },
    { label: "Áreas", c: p.areas, one: "área", many: "áreas" },
    { label: "Equipes", c: p.teams, one: "equipe", many: "equipes" },
    { label: "Funções", c: p.functions, one: "função", many: "funções" },
    { label: "Atividades", c: p.activities, one: "atividade", many: "atividades" },
  ].filter((r) => r.c.create || r.c.update);

  return (
    <>
      {p.saved ? (
        <p className="rounded-xl bg-emerald-500/15 px-3 py-2 text-sm text-emerald-200">✓ Pronto, a planilha foi gravada.</p>
      ) : p.nothing ? (
        <p className="rounded-xl bg-white/5 px-3 py-2 text-sm">A planilha não traz nada novo: tudo já está igual no app.</p>
      ) : (
        <p className="text-sm font-semibold">O que vai mudar</p>
      )}

      {rows.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border text-sm">
          {rows.map((r) => (
            <li key={r.label} className="px-3 py-2.5">
              <p>
                <span className="font-semibold">{r.label}:</span>{" "}
                {[
                  r.c.create ? (p.saved ? `${plural(r.c.create, r.one, r.many)} ${r.c.create === 1 ? "criada" : "criadas"}` : `criar ${plural(r.c.create, r.one, r.many)}`) : null,
                  r.c.update ? (p.saved ? `${r.c.update} ${r.c.update === 1 ? "atualizada" : "atualizadas"}` : `atualizar ${r.c.update}`) : null,
                ].filter(Boolean).join(" · ")}
              </p>
              <Names label="Novas" names={r.c.createNames} total={r.c.create} />
              <Names label={r.changed ?? "Com descrição nova"} names={r.c.updateNames} total={r.c.update} />
            </li>
          ))}
        </ul>
      )}

      {!p.saved && !p.nothing && (
        <p className="rounded-xl bg-white/5 px-3 py-2 text-sm text-muted">
          Nada será apagado e ninguém será desativado. Função em branco não muda a função da pessoa, e as atividades marcadas como feitas continuam feitas.
        </p>
      )}

      {p.warnings.length > 0 && (
        <details className="rounded-xl bg-amber-400/10 px-3 py-2 text-sm" open={p.ignoredAreas || p.warnings.length <= 3}>
          <summary className="cursor-pointer font-semibold text-amber-200">{plural(p.warnings.length + p.moreWarnings, "aviso", "avisos")}</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-100/90">
            {p.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </details>
      )}
    </>
  );
}

function Names({ label, names, total }: { label: string; names?: string[]; total: number }) {
  if (!names?.length) return null;
  const more = total - names.length;
  return (
    <p className="mt-0.5 text-muted">
      {label}: {names.join(", ")}{more > 0 ? ` e mais ${more}` : ""}
    </p>
  );
}
