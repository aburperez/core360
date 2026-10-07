import type { NotificationType, OccurrenceStatus, ParticipantRole, Priority, ValidationStatus } from "../../generated/prisma/enums";
import type { Actor } from "../../server/authz/actor";
import { canClaimOccurrence, canSeeOccurrence } from "../../server/authz/policy";
import { formatTime } from "../../lib/format";

/**
 * Quem recebe qual aviso. Funções puras: recebem o chamado, a mudança e as
 * pessoas do evento, e devolvem a lista de avisos. Todo destinatário passa
 * pela MESMA regra de visibilidade do resto do sistema (canSeeOccurrence):
 * ninguém é avisado de um chamado que não poderia abrir.
 */

export interface Snapshot {
  status: OccurrenceStatus;
  priority: Priority;
  responsible: string | null;
  areaId: string;
  teamId: string;
  validation: ValidationStatus;
}

export interface Change {
  id: bigint | number | string;
  kind: "CREATE" | "UPDATE";
  old: Snapshot | null;
  new: Snapshot;
  actorUserId: string | null;
}

export interface OccInfo {
  id: string;
  number: number;
  title: string;
  eventId: string;
  clientId: string;
  areaId: string;
  teamId: string;
  responsibleParticipantId: string | null;
  status: OccurrenceStatus;
  slaDueAt: Date | null;
  eventName: string;
  areaName: string;
  teamName: string;
}

/** Participação ativa de alguém com login ativo. */
export interface Person {
  participantId: string;
  userId: string;
  eventId: string;
  role: ParticipantRole;
  areaId: string | null;
  teamId: string | null;
}

export interface Planned {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  dedupeKey: string;
  /** Vai também para o WhatsApp (se a pessoa aceitou). Sem isso, vale WHATSAPP_TYPES. */
  whatsapp?: boolean;
}

/**
 * Avisos que também vão para o WhatsApp de quem aceitou. Os demais ficam só no app.
 * Urgente e lembrete não estão aqui: no WhatsApp eles vão só para o encarregado
 * da área (ver planForChange e planUrgentReminders).
 */
export const WHATSAPP_TYPES = new Set<NotificationType>([
  "BLOQUEIO", "ATRIBUIDA", "SLA_PROXIMO", "SLA_ESTOURADO", "REPROVADA",
]);

/** Sem resposta do encarregado, o urgente é reenviado a cada 5 minutos, até 3 vezes. */
export const REMINDER_EVERY_MS = 5 * 60_000;
export const MAX_REMINDERS = 3;

export const HEADLINE: Record<NotificationType, string> = {
  NOVA: "Novo chamado na sua equipe",
  URGENTE: "Chamado urgente",
  LEMBRETE: "Urgente sem resposta",
  BLOQUEIO: "Chamado bloqueado",
  ATRIBUIDA: "Chamado atribuído a você",
  SLA_PROXIMO: "SLA perto de estourar",
  SLA_ESTOURADO: "SLA estourado",
  CONCLUIDA: "Concluído, falta validar",
  REPROVADA: "Chamado reprovado na validação",
  COTACAO: "Cotação",
};

const CLOSED: OccurrenceStatus[] = ["CONCLUIDO", "CANCELADO"];

/** Monta um "Actor" mínimo para reaproveitar a matriz de permissões. */
function asActor(p: Person, clientId: string): Actor {
  return {
    userId: p.userId, name: "", email: "", meta: {},
    isPlatformAdmin: false, adminAgencies: [], adminEventIds: new Set(), supportEventIds: new Set(), suspendedAgencies: [],
    memberships: [{ participantId: p.participantId, eventId: p.eventId, clientId, role: p.role, areaId: p.areaId, teamId: p.teamId }],
    run: () => Promise.reject(new Error("somente leitura")),
  };
}

export function personCanSee(p: Person, occ: OccInfo): boolean {
  return canSeeOccurrence(asActor(p, occ.clientId), occ);
}

export function personCanClaim(p: Person, occ: OccInfo): boolean {
  return canClaimOccurrence(asActor(p, occ.clientId), occ);
}

const isUrgent = (s: Snapshot | null) => !!s && (s.status === "URGENTE" || s.priority === "CRITICA");

function audience(people: Person[], occ: { areaId: string; teamId: string; responsible: string | null }) {
  return {
    gerentes: people.filter((p) => p.role === "GERENTE"),
    heads: people.filter((p) => p.role === "HEAD" && p.areaId === occ.areaId),
    team: people.filter((p) => p.role === "OPERACIONAL" && p.teamId === occ.teamId),
    responsible: people.filter((p) => p.participantId === occ.responsible),
  };
}

/** Encarregado do setor: o Head da área do chamado. Área sem Head: o Gerente do evento. */
function encarregados(a: ReturnType<typeof audience>) {
  return a.heads.length ? a.heads : a.gerentes;
}

function build(occ: OccInfo, exclude: string | null) {
  const out = new Map<string, Planned>();
  const subject = `#${occ.number} ${occ.title}`;
  const where = `${occ.teamName} · ${occ.areaName}`;
  return {
    where,
    add(list: Person[], type: NotificationType, key: string, body = where, whatsapp?: boolean) {
      for (const p of list) {
        if (p.userId === exclude || out.has(`${p.userId}:${key}`)) continue;
        if (!personCanSee(p, occ)) continue;
        out.set(`${p.userId}:${key}`, {
          userId: p.userId, type, title: `${HEADLINE[type]}: ${subject}`, body, dedupeKey: key,
          ...(whatsapp !== undefined && { whatsapp }),
        });
      }
    },
    result: () => [...out.values()],
  };
}

/** Avisos gerados por uma criação ou mudança de chamado. */
export function planForChange(change: Change, occ: OccInfo, people: Person[]): Planned[] {
  const now = change.new;
  const before = change.old;
  // Quem fez a mudança não recebe aviso dela.
  const b = build(occ, change.actorUserId);
  const a = audience(people.filter((p) => p.eventId === occ.eventId), now);
  const open = !CLOSED.includes(now.status);

  if (open && isUrgent(now) && !isUrgent(before)) {
    const key = `urgente:${occ.id}`;
    // WhatsApp: só o encarregado do setor. Se ele não abrir o chamado, planUrgentReminders reenvia.
    b.add(encarregados(a), "URGENTE", key, b.where, true);
    // No app (sino), todos que respondem pelo chamado ficam sabendo. Sem responsável, a equipe toda.
    b.add([...a.gerentes, ...a.heads, ...(now.responsible ? a.responsible : a.team)], "URGENTE", key, b.where, false);
  }
  if (open && now.status === "BLOQUEIO" && before?.status !== "BLOQUEIO") {
    b.add([...a.gerentes, ...a.heads, ...a.responsible], "BLOQUEIO", `bloqueio:${occ.id}:${change.id}`);
  }
  if (open && now.responsible && now.responsible !== before?.responsible) {
    b.add(a.responsible, "ATRIBUIDA", `atribuida:${occ.id}:${now.responsible}`);
  }
  if (open && change.kind === "CREATE" && !now.responsible && !isUrgent(now)) {
    b.add(a.team, "NOVA", `nova:${occ.id}`);
  }
  if (now.status === "CONCLUIDO" && before?.status !== "CONCLUIDO") {
    b.add(a.heads.length ? a.heads : a.gerentes, "CONCLUIDA", `concluida:${occ.id}:${change.id}`);
  }
  if (now.validation === "REPROVADA" && before?.validation !== "REPROVADA") {
    b.add(a.responsible.length ? a.responsible : a.team, "REPROVADA", `reprovada:${occ.id}:${change.id}`);
  }
  return b.result();
}

/** Avisos de prazo. `late` = já venceu. A chave inclui o prazo: se ele mudar, avisa de novo. */
export function planForSla(occ: OccInfo, people: Person[], late: boolean): Planned[] {
  if (!occ.slaDueAt || CLOSED.includes(occ.status)) return [];
  const b = build(occ, null);
  const a = audience(people.filter((p) => p.eventId === occ.eventId), { ...occ, responsible: occ.responsibleParticipantId });
  const who = occ.responsibleParticipantId ? a.responsible : a.team;
  const due = occ.slaDueAt.getTime();
  const at = formatTime(occ.slaDueAt);
  if (late) {
    b.add([...who, ...a.heads, ...a.gerentes], "SLA_ESTOURADO", `sla-estourado:${occ.id}:${due}`, `Venceu às ${at} · ${occ.teamName}`);
  } else {
    b.add([...who, ...a.heads], "SLA_PROXIMO", `sla-proximo:${occ.id}:${due}`, `Vence às ${at} · ${occ.teamName}`);
  }
  return b.result();
}

/**
 * Lembrete do urgente: o encarregado recebeu o aviso há `n` × 5 minutos e ainda
 * não abriu nem mexeu no chamado (quem confere isso é o despacho). Só vale para
 * quem continua sendo o encarregado da área do chamado.
 */
export function planUrgentReminder(occ: OccInfo, people: Person[], userId: string, n: number): Planned[] {
  if (CLOSED.includes(occ.status) || n < 1 || n > MAX_REMINDERS) return [];
  const b = build(occ, null);
  const a = audience(people.filter((p) => p.eventId === occ.eventId), { ...occ, responsible: occ.responsibleParticipantId });
  const minutes = (n * REMINDER_EVERY_MS) / 60_000;
  b.add(
    encarregados(a).filter((p) => p.userId === userId),
    "LEMBRETE", `urgente-lembrete:${occ.id}:${n}`, `Sem resposta há ${minutes} min · ${b.where}`, true,
  );
  return b.result();
}
