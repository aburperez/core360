import type { OccurrenceStatus } from "../../generated/prisma/enums";
import { isEventAdmin, membershipFor, type Actor, type ClientView, type EventRole } from "./actor";

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

// ─────────────────────── Cliente ───────────────────────
// O Cliente só olha, e só o que o Gerente (ou o Admin) liberar. Espelha
// app.is_client, app.client_can e app.can_grant_client_view.

/** A pessoa está neste evento como Cliente (e não é Admin dele). */
export function isClient(a: Actor, eventId: string): boolean {
  return !isEventAdmin(a, eventId) && membershipFor(a, eventId)?.role === "CLIENTE";
}

/** O Cliente tem esta parte liberada: custos, equipe ou andamento. */
export function clientCan(a: Actor, eventId: string, view: keyof ClientView): boolean {
  const m = membershipFor(a, eventId);
  return m?.role === "CLIENTE" && !!m.clientView?.[view];
}

/** Liberar ou fechar o que o Cliente vê: o Gerente do evento ou o Admin. */
export function canGrantClientView(a: Actor, eventId: string): boolean {
  if (isEventAdmin(a, eventId)) return true;
  return membershipFor(a, eventId)?.role === "GERENTE";
}

const clientSeesStructure = (a: Actor, eventId: string) => clientCan(a, eventId, "team") || clientCan(a, eventId, "progress");

export function canSeeArea(a: Actor, s: Scope): boolean {
  if (isEventAdmin(a, s.eventId)) return true;
  const m = membershipFor(a, s.eventId);
  if (!m) return false;
  if (m.role === "CLIENTE") return clientSeesStructure(a, s.eventId);
  return m.role === "GERENTE" || m.role === "HEAD" || m.role === "PRE_PRODUTOR" || m.areaId === s.areaId;
}

export function canManageAreas(a: Actor, eventId: string): boolean {
  if (isEventAdmin(a, eventId)) return true;
  const m = membershipFor(a, eventId);
  return m?.role === "GERENTE";
}

export function canSeeTeam(a: Actor, s: Scope): boolean {
  if (isEventAdmin(a, s.eventId)) return true;
  const m = membershipFor(a, s.eventId);
  if (!m) return false;
  switch (m.role) {
    case "GERENTE":
    case "PRE_PRODUTOR":
      return true;
    case "CLIENTE":
      return clientSeesStructure(a, s.eventId);
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
  return m.role === "GERENTE" || (m.role === "HEAD" && m.areaId === s.areaId);
}

/** Anti-escalada: quem pode atribuir qual papel (seção 7.4 da proposta). */
export function assignableRoles(a: Actor, eventId: string, areaId?: string | null): EventRole[] {
  if (isEventAdmin(a, eventId)) return ["GERENTE", "HEAD", "OPERACIONAL", "CLIENTE", "PRE_PRODUTOR"];
  const m = membershipFor(a, eventId);
  switch (m?.role) {
    case "GERENTE":
      return ["HEAD", "OPERACIONAL", "CLIENTE", "PRE_PRODUTOR"];
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
      return clientCan(a, o.eventId, "progress");
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

const FIELD_ROLES: readonly EventRole[] = ["GERENTE", "HEAD", "OPERACIONAL"];

/** Dá função a alguém neste evento: a Pré-produção (a qualquer um do campo) e o Head (aos Operacionais da área dele). */
export function canGiveFunctions(a: Actor, eventId: string): boolean {
  return canUsePreProduction(a, eventId) || membershipFor(a, eventId)?.role === "HEAD";
}

/** Pode dar função a esta pessoa? Espelha app.can_give_function. */
export function canGiveFunction(
  a: Actor,
  eventId: string,
  p: { role: EventRole; areaId: string | null; active: boolean },
): boolean {
  if (!p.active || !FIELD_ROLES.includes(p.role)) return false;
  if (canUsePreProduction(a, eventId)) return true;
  const m = membershipFor(a, eventId);
  return m?.role === "HEAD" && !!m.areaId && p.role === "OPERACIONAL" && p.areaId === m.areaId;
}

/** Gestão de campo (painel, chamados): quem trabalha no campo. O Cliente tem a tela dele. */
export function canUseField(a: Actor, eventId: string): boolean {
  if (isEventAdmin(a, eventId)) return true;
  const m = membershipFor(a, eventId);
  return !!m && m.role !== "PRE_PRODUTOR" && m.role !== "CLIENTE";
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

/** Marcar Montado e Conferido no item: o gestor ou o Head da área do item. Espelha app.can_assemble. */
export function canAssemble(a: Actor, eventId: string, areaId: string | null): boolean {
  if (canSendToField(a, eventId)) return true;
  const m = membershipFor(a, eventId);
  return m?.role === "HEAD" && !!areaId && m.areaId === areaId;
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
// O campo vê, e o Cliente com o andamento liberado (só olhando). Espelha
// app.can_see_plans, app.can_manage_plans, app.can_edit_plan_point e
// app.can_work_plan_point.

export function canSeePlans(a: Actor, eventId: string): boolean {
  return canUseField(a, eventId) || clientCan(a, eventId, "progress");
}

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
