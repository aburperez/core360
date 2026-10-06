"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, cx } from "@/components/ui";
import { FormError, Input, Label, Select, Textarea } from "@/components/field";
import { PhotoPicker } from "@/components/photo-picker";
import { api } from "@/components/api-client";
import { uploadPhoto } from "@/components/photo";

type Team = { id: string; name: string; area: string };
type Person = { id: string; name: string; teamId: string | null; jobTitle: string | null };

const PRIORITIES = [
  { v: "BAIXA", l: "Baixa" },
  { v: "NORMAL", l: "Normal" },
  { v: "ALTA", l: "Alta" },
  { v: "CRITICA", l: "Crítica" },
] as const;

/**
 * Formulário rápido: foto → o que aconteceu → prioridade → enviar.
 * Evento/área vêm da equipe; quem é Operacional já tem a equipe preenchida.
 * O ID é gerado aqui: reenviar depois de uma queda de sinal não duplica o chamado.
 */
export function NewOccurrenceForm(props: {
  eventId: string;
  teams: Team[];
  defaultTeamId: string;
  people: Person[];
  meParticipantId: string | null;
}) {
  const router = useRouter();
  const id = useRef(crypto.randomUUID());
  const [teamId, setTeamId] = useState(props.defaultTeamId);
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]["v"]>("NORMAL");
  const [photos, setPhotos] = useState<File[]>([]);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"idle" | "saving" | "photos">("idle");

  const teamPeople = useMemo(() => props.people.filter((p) => p.teamId === teamId), [props.people, teamId]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    setStep("saving");
    try {
      await api(`/api/events/${props.eventId}/occurrences`, {
        body: {
          id: id.current,
          teamId,
          title: f.get("title"),
          description: f.get("description") || null,
          process: f.get("process") || null,
          type: f.get("type") || "OCORRENCIA",
          priority,
          status: f.get("blocked") ? "BLOQUEIO" : priority === "CRITICA" ? "URGENTE" : "PENDENTE",
          responsibleParticipantId: f.get("responsible") || null,
        },
      });
      setStep("photos");
      for (const file of photos) await uploadPhoto(id.current, file);
      router.replace(`/eventos/${props.eventId}/ocorrencias/${id.current}`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setStep("idle");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <PhotoPicker files={photos} onChange={setPhotos} />

      <label className="block">
        <Label>O que aconteceu?</Label>
        <Input name="title" required maxLength={160} placeholder="Ex.: Quadro do palco 2 desarmando" autoComplete="off" />
      </label>

      <div>
        <Label>Prioridade</Label>
        <div className="grid grid-cols-4 gap-2">
          {PRIORITIES.map((p) => (
            <button
              key={p.v}
              type="button"
              onClick={() => setPriority(p.v)}
              aria-pressed={priority === p.v}
              className={cx(
                "min-h-12 rounded-xl border text-sm font-semibold",
                priority === p.v
                  ? p.v === "CRITICA" ? "border-red-600 bg-red-600 text-white" : "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-surface",
              )}
            >
              {p.l}
            </button>
          ))}
        </div>
      </div>

      {props.teams.length > 1 || !props.defaultTeamId ? (
        <label className="block">
          <Label>Equipe</Label>
          <Select value={teamId} onChange={(e) => setTeamId(e.target.value)} required>
            <option value="" disabled>Escolha a equipe</option>
            {props.teams.map((t) => (
              <option key={t.id} value={t.id}>{t.area} › {t.name}</option>
            ))}
          </Select>
        </label>
      ) : (
        <p className="text-sm text-muted">Equipe: <strong className="text-foreground">{props.teams.find((t) => t.id === teamId)?.area} › {props.teams.find((t) => t.id === teamId)?.name}</strong></p>
      )}

      <button type="button" onClick={() => setMore(!more)} className="text-sm font-medium text-primary">
        {more ? "− Menos detalhes" : "+ Mais detalhes (descrição, responsável, tipo)"}
      </button>

      {more && (
        <div className="space-y-4">
          <label className="block">
            <Label hint="(opcional)">Descrição</Label>
            <Textarea name="description" maxLength={4000} />
          </label>
          <label className="block">
            <Label hint="(opcional)">Tarefa / processo</Label>
            <Input name="process" maxLength={160} />
          </label>
          <label className="block">
            <Label>Responsável</Label>
            <Select name="responsible" defaultValue={teamPeople.some((p) => p.id === props.meParticipantId) ? props.meParticipantId ?? "" : ""}>
              <option value="">Sem responsável (equipe)</option>
              {teamPeople.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.jobTitle ? ` — ${p.jobTitle}` : ""}</option>
              ))}
            </Select>
          </label>
          <label className="block">
            <Label>Tipo</Label>
            <Select name="type" defaultValue="OCORRENCIA">
              <option value="OCORRENCIA">Ocorrência</option>
              <option value="TAREFA">Tarefa</option>
            </Select>
          </label>
          <label className="flex min-h-12 items-center gap-3">
            <input type="checkbox" name="blocked" className="h-6 w-6" />
            <span>Está bloqueando a operação</span>
          </label>
        </div>
      )}

      <FormError message={error} />
      <Button type="submit" className="w-full" disabled={step !== "idle" || !teamId}>
        {step === "saving" ? "Enviando…" : step === "photos" ? "Enviando fotos…" : error ? "Tentar de novo" : "Abrir chamado"}
      </Button>
    </form>
  );
}
