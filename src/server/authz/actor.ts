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
  isAdmin: boolean;
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
    const participations = await tx.participant.findMany({
      where: { userId, active: true, deletedAt: null, event: { deletedAt: null } },
      select: { id: true, eventId: true, role: true, areaId: true, teamId: true, event: { select: { clientId: true } } },
    });
    return { user, participations };
  });
  if (!data) return null;

  return {
    userId,
    name: data.user.name,
    email: data.user.email,
    isAdmin: data.user.isAdmin,
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
