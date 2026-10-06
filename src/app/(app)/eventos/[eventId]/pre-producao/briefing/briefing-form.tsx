"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { FormError, Input, Label, Textarea } from "@/components/field";
import { api } from "@/components/api-client";
import type { BriefingText } from "@/components/briefing-view";

const EMPTY: BriefingText = { roleText: null, post: null, schedule: null, duties: null, notes: null };

/**
 * Formulário do briefing. Serve para uma pessoa (PUT no briefing dela) ou
 * para a equipe toda (PUT na equipe, substituindo o que havia).
 */
export function BriefingForm(props: {
  action: { kind: "person"; eventId: string; participantId: string; briefingId: string | null; wasRead: boolean }
    | { kind: "team"; teamId: string; people: number; withBriefing: number; back: string };
  initial?: BriefingText | null;
  jobTitle?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const v = props.initial ?? EMPTY;
  const a = props.action;

  const submit = async (form: HTMLFormElement) => {
    const f = new FormData(form);
    const body = Object.fromEntries(["roleText", "post", "schedule", "duties", "notes"].map((k) => [k, String(f.get(k) ?? "")]));
    if (a.kind === "team") {
      const msg = a.withBriefing
        ? `Aplicar este briefing às ${a.people} pessoas da equipe? ${a.withBriefing} já tinham briefing e ele será substituído.`
        : `Aplicar este briefing às ${a.people} pessoas da equipe?`;
      if (!confirm(msg)) return;
    }
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      if (a.kind === "person") {
        const r = await api<{ state: string }>(`/api/events/${a.eventId}/briefings/${a.participantId}`, { method: "PUT", body });
        setSaved(r.state === "MUDOU" ? "Salvo. Como já tinha lido, a pessoa vai ver que mudou e confirmar de novo." : "Salvo. A pessoa vê em “Meu briefing”.");
        router.refresh();
      } else {
        await api(`/api/teams/${a.teamId}/briefing`, { method: "PUT", body });
        router.push(a.back);
        router.refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit(e.currentTarget);
      }}
    >
      <label className="block">
        <Label hint={props.jobTitle ? `(vazio = ${props.jobTitle})` : "(opcional)"}>Função</Label>
        <Input name="roleText" maxLength={120} defaultValue={v.roleText ?? ""} placeholder={props.jobTitle ?? "Ex.: Eletricista de palco"} />
      </label>
      <label className="block">
        <Label>Posto</Label>
        <Input name="post" maxLength={500} defaultValue={v.post ?? ""} placeholder="Ex.: Palco 2, ao lado do gerador G3" />
      </label>
      <label className="block">
        <Label>Horários</Label>
        <Textarea name="schedule" maxLength={2000} defaultValue={v.schedule ?? ""} placeholder={"Ex.: Sex 10/04: 08h às 20h (montagem)\nSáb 11/04: 14h às 02h (show)"} className="min-h-20" />
      </label>
      <label className="block">
        <Label>O que faz</Label>
        <Textarea name="duties" maxLength={4000} defaultValue={v.duties ?? ""} placeholder="Ex.: Ronda nos quadros a cada 2 horas; primeiro atendimento de falta de energia nos palcos 1 e 2." className="min-h-32" />
      </label>
      <label className="block">
        <Label hint="(opcional)">Observações</Label>
        <Textarea name="notes" maxLength={2000} defaultValue={v.notes ?? ""} placeholder="Ex.: Usar EPI completo; credencial retirada no portão 3." className="min-h-20" />
      </label>
      <FormError message={error} />
      {saved && <p className="text-sm text-emerald-300">{saved}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy} className="flex-1 lg:flex-none">
          {busy ? "Salvando…" : a.kind === "team" ? `Aplicar às ${a.people} pessoas` : "Salvar briefing"}
        </Button>
        {a.kind === "person" && a.briefingId && (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              if (!confirm("Apagar este briefing? A pessoa deixa de ver em “Meu briefing”.")) return;
              setBusy(true);
              try {
                await api(`/api/briefings/${a.briefingId}`, { method: "DELETE" });
                router.refresh();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Apagar
          </Button>
        )}
      </div>
    </form>
  );
}
