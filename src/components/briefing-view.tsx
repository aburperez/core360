import type { ReactNode } from "react";
import { ROLE_LABEL, formatDuration } from "@/lib/format";
import type { ParticipantRole } from "@/generated/prisma/enums";
import { Card, cx } from "./ui";

export type BriefingText = {
  roleText: string | null;
  post: string | null;
  schedule: string | null;
  duties: string | null;
  notes: string | null;
};

export type BriefingAuto = {
  types: { id: string; name: string; slaMinutes: number | null }[];
  contacts: { id: string; name: string; role: ParticipantRole; jobTitle: string | null; phone: string | null; isLeader: boolean }[];
};

export const BRIEFING_STATE = {
  SEM: { label: "Sem briefing", tone: "bg-white/10 text-muted" },
  NAO_LIDO: { label: "Não leu", tone: "bg-amber-400/15 text-amber-300" },
  LIDO: { label: "✓ Leu", tone: "bg-emerald-500/15 text-emerald-300" },
  MUDOU: { label: "Mudou, falta ler", tone: "bg-amber-400/15 text-amber-300" },
} as const;

export function BriefingPill({ state, className }: { state: keyof typeof BRIEFING_STATE; className?: string }) {
  const s = BRIEFING_STATE[state];
  return <span className={cx("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold", s.tone, className)}>{s.label}</span>;
}

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <div className="mt-1 whitespace-pre-line">{children}</div>
    </div>
  );
}

/** O briefing como a pessoa lê: o texto da Pré-produção e o que entra sozinho. */
export function BriefingView({ text, jobTitle, auto, team }: { text: BriefingText; jobTitle: string | null; auto: BriefingAuto; team?: string | null }) {
  const role = text.roleText || jobTitle;
  return (
    <div className="space-y-3">
      <Card className="space-y-4">
        {(role || team) && <Block label="Função">{[role, team].filter(Boolean).join(" · ")}</Block>}
        {text.post && <Block label="Posto">{text.post}</Block>}
        {text.schedule && <Block label="Horários">{text.schedule}</Block>}
        {text.duties && <Block label="O que você faz">{text.duties}</Block>}
        {text.notes && <Block label="Observações">{text.notes}</Block>}
      </Card>
      <BriefingAutoView auto={auto} />
    </div>
  );
}

export function BriefingAutoView({ auto, editing }: { auto: BriefingAuto; editing?: boolean }) {
  return (
    <Card className="space-y-4">
      <Block label="Tipos de atendimento">
        {auto.types.length === 0 ? (
          <span className="text-sm text-muted">{editing ? "Nenhum. Marque em Quem faz o quê." : "Nenhum tipo marcado para você."}</span>
        ) : (
          <ul className="space-y-1">
            {auto.types.map((t) => (
              <li key={t.id} className="flex items-baseline justify-between gap-3">
                <span>{t.name}</span>
                <span className="shrink-0 text-sm text-muted">{t.slaMinutes ? `prazo ${formatDuration(t.slaMinutes * 60)}` : "prazo da prioridade"}</span>
              </li>
            ))}
          </ul>
        )}
      </Block>
      <Block label="Com quem falar">
        {auto.contacts.length === 0 ? (
          <span className="text-sm text-muted">Ninguém cadastrado ainda.</span>
        ) : (
          <ul className="space-y-2">
            {auto.contacts.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block font-medium">{c.name}</span>
                  <span className="block text-sm text-muted">
                    {c.isLeader ? "Líder da equipe" : ROLE_LABEL[c.role]}{c.jobTitle ? ` · ${c.jobTitle}` : ""}
                  </span>
                </span>
                {c.phone && (
                  <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="shrink-0 rounded-xl border border-border px-3 py-2 text-sm font-semibold text-primary">
                    Ligar
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </Block>
    </Card>
  );
}
