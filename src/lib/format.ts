import type { OccurrenceStatus, ParticipantRole, Priority } from "../generated/prisma/enums";

export const STATUS_LABEL: Record<OccurrenceStatus, string> = {
  PENDENTE: "Pendente",
  EM_ANDAMENTO: "Em andamento",
  URGENTE: "Urgente",
  BLOQUEIO: "Bloqueio",
  CONCLUIDO: "Concluído",
  CANCELADO: "Cancelado",
};

export const STATUS_STYLE: Record<OccurrenceStatus, string> = {
  PENDENTE: "bg-amber-500/20 text-amber-200",
  EM_ANDAMENTO: "bg-brand-cyan/15 text-brand-cyan",
  URGENTE: "bg-red-600 text-white",
  BLOQUEIO: "bg-purple-500/25 text-purple-200",
  CONCLUIDO: "bg-emerald-500/20 text-emerald-200",
  CANCELADO: "bg-gray-500/20 text-gray-300",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  BAIXA: "Baixa",
  NORMAL: "Normal",
  ALTA: "Alta",
  CRITICA: "Crítica",
};

export const PRIORITY_STYLE: Record<Priority, string> = {
  BAIXA: "text-muted",
  NORMAL: "text-foreground",
  ALTA: "text-orange-300",
  CRITICA: "text-red-400 font-semibold",
};

export const ROLE_LABEL: Record<ParticipantRole | "ADMIN", string> = {
  ADMIN: "Admin",
  GERENTE: "Gerente",
  HEAD: "Head",
  OPERACIONAL: "Operacional",
  CLIENTE: "Cliente",
  PRE_PRODUTOR: "Pré-produtor",
};

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h < 24) return rest ? `${h} h ${rest} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

/** "vence em 12 min" / "atrasado 1 h 5 min" / "no prazo". */
export function slaText(dueAt: Date | string | null, now = new Date()): { text: string; tone: "ok" | "warn" | "late" | "none" } {
  if (!dueAt) return { text: "sem SLA", tone: "none" };
  const diff = Math.round((new Date(dueAt).getTime() - now.getTime()) / 1000);
  if (diff < 0) return { text: `atrasado ${formatDuration(-diff)}`, tone: "late" };
  return { text: `vence em ${formatDuration(diff)}`, tone: diff < 15 * 60 ? "warn" : "ok" };
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo",
  }).format(new Date(d));
}

export function formatDate(d: Date | string): string {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Sao_Paulo" }).format(new Date(d));
}

export function formatTime(d: Date | string): string {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(d));
}

/** Período em dias ("10/04 a 12/04"), no fuso do evento; um dia só aparece uma vez. */
export function formatPeriod(from: Date, to: Date | null, timeZone: string, withYear = false): string {
  const day = (d: Date) =>
    new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", ...(withYear ? { year: "numeric" } : {}), timeZone }).format(d);
  const a = day(from);
  const b = to ? day(to) : null;
  return b && b !== a ? `${a} a ${b}` : a;
}
