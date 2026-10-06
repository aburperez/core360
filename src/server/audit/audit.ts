import type { AuditAction } from "../../generated/prisma/enums";
import type { Prisma } from "../../generated/prisma/client";
import type { Actor } from "../authz/actor";
import type { Tx } from "../db/with-user";

export interface AuditEntry {
  eventId?: string | null;
  entity: string;
  entityId?: string | null;
  action: AuditAction;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/** Só os campos que mudaram, para o histórico ficar legível. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    const prev = before[key];
    const next = after[key];
    const same = prev instanceof Date && next instanceof Date ? prev.getTime() === next.getTime() : prev === next;
    if (!same) {
      b[key] = prev ?? null;
      a[key] = next ?? null;
    }
  }
  return { before: b, after: a };
}

function json(v: Record<string, unknown> | null | undefined): Prisma.InputJsonValue | undefined {
  return v ? (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue) : undefined;
}

/** Grava na MESMA transação da alteração: ou ficam as duas, ou nenhuma. */
export async function audit(tx: Tx, actor: Actor, e: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorUserId: actor.userId,
      eventId: e.eventId ?? null,
      entity: e.entity,
      entityId: e.entityId ?? null,
      action: e.action,
      before: json(e.before),
      after: json(e.after),
      ip: actor.meta.ip ?? null,
      userAgent: actor.meta.userAgent?.slice(0, 500) ?? null,
    },
  });
}
