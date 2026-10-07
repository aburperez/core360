import type { ParticipantRole } from "../../generated/prisma/enums";
import { withUser, type Db, type Tx } from "../db/with-user";

export type EventRole = ParticipantRole;

export interface Membership {
  participantId: string;
  eventId: string;
  clientId: string;
  role: EventRole;
  areaId: string | null;
  teamId: string | null;
}

export interface AgencyRef {
  id: string;
  name: string;
  /** SUPORTE: equipe CORE 360 autorizada pela agência. */
  role: "ADMIN" | "SUPORTE";
}

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Quem está fazendo o pedido. Montado no servidor a partir da sessão, a cada
 * requisição; nada aqui vem do navegador.
 */
export interface Actor {
  userId: string;
  name: string;
  email: string;
  /** Admin da plataforma: cria e suspende agências. Não abre eventos de ninguém. */
  isPlatformAdmin: boolean;
  /** Agências (ativas) em que a pessoa é Admin ou Suporte. */
  adminAgencies: AgencyRef[];
  /** Eventos dessas agências: neles a pessoa pode tudo, como Admin. */
  adminEventIds: ReadonlySet<string>;
  /** Os que ela vê só por ser Suporte (para o aviso na tela). */
  supportEventIds: ReadonlySet<string>;
  /** Agências suspensas em que a pessoa é Admin (só para o aviso na tela). */
  suspendedAgencies: AgencyRef[];
  memberships: Membership[];
  meta: RequestMeta;
  /** Executa no banco como este usuário (RLS ativa). */
  run<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

/**
 * Carrega o usuário e suas participações ATIVAS. Devolve null se o usuário
 * não existe ou está inativo: o chamador trata como não autenticado.
 */
export async function loadActor(db: Db, userId: string, meta: RequestMeta = {}): Promise<Actor | null> {
  const data = await withUser(db, userId, async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || !user.active) return null;
    // Evento de agência suspensa não aparece aqui: a RLS de events o esconde.
    const participations = await tx.participant.findMany({
      where: { userId, active: true, deletedAt: null, event: { deletedAt: null } },
      select: { id: true, eventId: true, role: true, areaId: true, teamId: true, event: { select: { clientId: true } } },
    });
    const admin = await tx.agencyAdmin.findMany({
      where: { userId, active: true },
      select: { role: true, agency: { select: { id: true, name: true, status: true } } },
      orderBy: { agency: { name: "asc" } },
    });
    const active = admin.filter((a) => a.agency.status === "ACTIVE").map((a) => ({ ...a.agency, role: a.role }));
    const events = active.length
      ? await tx.event.findMany({ where: { agencyId: { in: active.map((a) => a.id) } }, select: { id: true, agencyId: true } })
      : [];
    return { user, participations, admin, active, events };
  });
  if (!data) return null;

  return {
    userId,
    name: data.user.name,
    email: data.user.email,
    isPlatformAdmin: data.user.isAdmin,
    adminAgencies: data.active.map(({ id, name, role }) => ({ id, name, role })),
    adminEventIds: new Set(data.events.map((e) => e.id)),
    supportEventIds: new Set(
      data.events.filter((e) => data.active.some((a) => a.id === e.agencyId && a.role === "SUPORTE")).map((e) => e.id),
    ),
    suspendedAgencies: data.admin.filter((a) => a.agency.status !== "ACTIVE").map(({ role, agency: { id, name } }) => ({ id, name, role })),
    memberships: data.participations.map((p) => ({
      participantId: p.id,
      eventId: p.eventId,
      clientId: p.event.clientId,
      role: p.role,
      areaId: p.areaId,
      teamId: p.teamId,
    })),
    meta,
    run: (fn) => withUser(db, userId, fn),
  };
}

export function membershipFor(actor: Actor, eventId: string): Membership | undefined {
  return actor.memberships.find((m) => m.eventId === eventId);
}

/** Admin da agência dona do evento: no evento, pode tudo. */
export function isEventAdmin(actor: Actor, eventId: string): boolean {
  return actor.adminEventIds.has(eventId);
}

/** Admin ou Suporte desta agência (ou de alguma, sem agencyId). */
export function isAgencyAdmin(actor: Actor, agencyId?: string): boolean {
  return agencyId ? actor.adminAgencies.some((a) => a.id === agencyId) : actor.adminAgencies.length > 0;
}

/** Admin de verdade (não Suporte): cuida dos Admins e do Suporte da agência. */
export function isAgencyFullAdmin(actor: Actor, agencyId: string): boolean {
  return actor.adminAgencies.some((a) => a.id === agencyId && a.role === "ADMIN");
}

/** Está neste evento como Suporte (para o aviso na tela). */
export function isEventSupport(actor: Actor, eventId: string): boolean {
  return actor.supportEventIds.has(eventId);
}
