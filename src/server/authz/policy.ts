import type { OccurrenceStatus } from "../../generated/prisma/enums";
import { isEventAdmin, membershipFor, type Actor, type EventRole } from "./actor";

/**
 * Matriz de permissões do backend. Espelha as funções app.* da migration de RLS
 * (prisma/migrations/*_rls_access_control): o banco garante o perímetro, e aqui
 * ficam também as regras finas de ação. Funções puras, testadas em
 * tests/authz/policy.test.ts.
 */

type Scope = { eventId: string; areaId?: string | null; teamId?: string | null };

export function canSeeEvent(a: Actor, eventId: string): boolean {
  return isEventAdmin(a, eventId) || !!membershipFor(a, eventId);
}

export function canSeeArea(a: Actor, s: Scope): boolean {
  if (isEventAdmin(a, s.eventId)) return true;
  const m = membershipFor(a, s.eventId);
  if (!m) return false;
  return m.role === "GERENTE" || m.role === "CLIENTE" || m.role === "HEAD" || m.role === "PRE_PRODUTOR" || m.areaId === s.areaId;
}

export function canManageAreas(a: Actor, eventId: string): boolean {
  if (isEventAdmin(a, eventId)) return true;
  const m = membershipFor(a, eventId);
  return m?.role === "GERENTE" || m?.role === "CLIENTE";
}

export function canSeeTeam(a: Actor, s: Scope): boolean {
  if (isEventAdmin(a, s.eventId)) return true;
  const m = membershipFor(a, s.eventId);
  if (!m) return false;
  switch (m.role) {
    case "GERENTE":
    case "CLIENTE":
    case "PRE_PRODUTOR":
      return true;
    case "HEAD":
      return m.areaId === s.areaId;
    case "OPERACIONAL":
      return m.teamId === s.teamId;
  }
}

export function canManageTeams(a: Actor, s: Scope): boolean {
  if (isEventAdmin(a, s.eventId)) return true;
  const m = membershipFor(a, s.eventId);
  if (!m) return false;
  return m.role === "GERENTE" || m.role === "CLIENTE" || (m.role === "HEAD" && m.areaId === s.areaId);
}

/** Anti-escalada: quem pode atribuir qual papel (seção 7.4 da proposta). */
export function assignableRoles(a: Actor, eventId: string, areaId?: string | null): EventRole[] {
  if (isEventAdmin(a, eventId)) return ["GERENTE", "HEAD", "OPERACIONAL", "CLIENTE", "PRE_PRODUTOR"];
  const m = membershipFor(a, eventId);
  switch (m?.role) {
    case "GERENTE":
      return ["HEAD", "OPERACIONAL", "CLIENTE", "PRE_PRODUTOR"];
    case "CLIENTE":
      return ["CLIENTE", "OPERACIONAL"];
    case "HEAD":
      return areaId && areaId === m.areaId ? ["OPERACIONAL"] : [];
    default:
      return [];
  }
}

export function canAssignRole(a: Actor, s: Scope & { role: EventRole }): boolean {
  return assignableRoles(a, s.eventId, s.areaId).includes(s.role);
}

/** Pode abrir a tela "Montar equipe" deste evento. */
export function canBuildTeam(a: Actor, eventId: string): boolean {
  return assignableRoles(a, eventId, membershipFor(a, eventId)?.areaId).length > 0;
}

type OccScope = Scope & { responsibleParticipantId?: string | null };

export function canSeeOccurrence(a: Actor, o: OccScope): boolean {
  if (isEventAdmin(a, o.eventId)) return true;
  const m = membershipFor(a, o.eventId);
  if (!m) return false;
  switch (m.role) {
    case "GERENTE":
      return true;
    case "HEAD":
      return m.areaId === o.areaId;
    case "OPERACIONAL":
      return m.teamId === o.teamId || m.participantId === o.responsibleParticipantId;
    case "CLIENTE":
    case "PRE_PRODUTOR":
      return false;
  }
}

/** Abrir ocorrência nesta área/equipe. */
export function canCreateOccurrence(a: Actor, s: Scope): boolean {
  if (isEventAdmin(a, s.eventId)) return true;
  const m = membershipFor(a, s.eventId);
  if (!m) return false;
  switch (m.role) {
    case "GERENTE":
      return true;
    case "HEAD":
      return m.areaId === s.areaId;
    case "OPERACIONAL":
      return m.teamId === s.teamId;
    case "CLIENTE":
    case "PRE_PRODUTOR":
      return false;
  }
}

/** Gerir a ocorrência: reatribuir, mudar prioridade, cancelar. */
export function canManageOccurrence(a: Actor, o: OccScope): boolean {
  if (isEventAdmin(a, o.eventId)) return true;
  const m = membershipFor(a, o.eventId);
  return m?.role === "GERENTE" || (m?.role === "HEAD" && m.areaId === o.areaId);
}

/**
 * Mudar status ou concluir. Operacional só nas ocorrências atribuídas a ele.
 * Cancelar é ação de gestão (canManageOccurrence).
 */
export function canWorkOccurrence(a: Actor, o: OccScope, to?: OccurrenceStatus): boolean {
  if (to === "CANCELADO") return canManageOccurrence(a, o);
  if (canManageOccurrence(a, o)) return true;
  const m = membershipFor(a, o.eventId);
  return m?.role === "OPERACIONAL" && !!o.responsibleParticipantId && m.participantId === o.responsibleParticipantId;
}

export const canValidateOccurrence = canManageOccurrence;

/** Operacional "assume" um chamado da própria equipe que está sem responsável. */
export function canClaimOccurrence(a: Actor, o: OccScope & { status?: OccurrenceStatus }): boolean {
  if (o.responsibleParticipantId || o.status === "CONCLUIDO" || o.status === "CANCELADO") return false;
  const m = membershipFor(a, o.eventId);
  return m?.role === "OPERACIONAL" && m.teamId === o.teamId;
}

// ─────────────────────── Pré-produção ───────────────────────
// Separada do campo: só o Pré-produtor e o gestor (Gerente do evento) entram.

/** Ver e trabalhar na Pré-produção: tipos, quem faz o quê, propor SLA. */
export function canUsePreProduction(a: Actor, eventId: string): boolean {
  if (isEventAdmin(a, eventId)) return true;
  const m = membershipFor(a, eventId);
  return m?.role === "GERENTE" || m?.role === "PRE_PRODUTOR";
}

/** Gestão de campo (painel, chamados): todos menos o Pré-produtor. */
export function canUseField(a: Actor, eventId: string): boolean {
  if (isEventAdmin(a, eventId)) return true;
  const m = membershipFor(a, eventId);
  return !!m && m.role !== "PRE_PRODUTOR";
}

/** Aprovar, ajustar, recusar ou definir o SLA: só o gestor. */
export function canReviewSla(a: Actor, eventId: string): boolean {
  if (isEventAdmin(a, eventId)) return true;
  return membershipFor(a, eventId)?.role === "GERENTE";
}

/** Escolher quem recebe cada item da planilha e enviar para o campo: só o gestor. */
export function canSendToField(a: Actor, eventId: string): boolean {
  if (isEventAdmin(a, eventId)) return true;
  return membershipFor(a, eventId)?.role === "GERENTE";
}

/** A participação da pessoa logada neste evento é esta? (quem recebe um item) */
export function isMe(a: Actor, eventId: string, participantId: string): boolean {
  return membershipFor(a, eventId)?.participantId === participantId;
}

/** Escrever as observações do dia no relatório diário: só o gestor. */
export function canWriteReport(a: Actor, eventId: string): boolean {
  if (isEventAdmin(a, eventId)) return true;
  return membershipFor(a, eventId)?.role === "GERENTE";
}

// ─────────────────────── Planta do evento ───────────────────────
// Todos do campo veem (canUseField). Espelha app.can_manage_plans,
// app.can_edit_plan_point e app.can_work_plan_point.

/** Enviar, renomear e apagar plantas: o gestor. */
export function canManagePlans(a: Actor, eventId: string): boolean {
  if (isEventAdmin(a, eventId)) return true;
  return membershipFor(a, eventId)?.role === "GERENTE";
}

/** Marcar, editar e apagar uma etapa: o gestor, ou o Head da área da etapa. */
export function canEditPlanPoint(a: Actor, s: { eventId: string; areaId: string | null }): boolean {
  if (isEventAdmin(a, s.eventId)) return true;
  const m = membershipFor(a, s.eventId);
  return m?.role === "GERENTE" || (m?.role === "HEAD" && !!s.areaId && m.areaId === s.areaId);
}

/** Iniciar e concluir a etapa: quem edita, o responsável e o Operacional da equipe dela. */
export function canWorkPlanPoint(
  a: Actor,
  s: { eventId: string; areaId: string | null; teamId: string | null; responsibleId: string | null },
): boolean {
  if (canEditPlanPoint(a, s)) return true;
  const m = membershipFor(a, s.eventId);
  if (m?.role !== "HEAD" && m?.role !== "OPERACIONAL") return false;
  return (!!s.responsibleId && m.participantId === s.responsibleId) || (m.role === "OPERACIONAL" && !!s.teamId && m.teamId === s.teamId);
}
