import { z } from "zod";
import type { Actor } from "../../server/authz/actor";
import { canGrantHeadAreas } from "../../server/authz/policy";
import { audit } from "../../server/audit/audit";
import { ForbiddenError, NotFoundError, ValidationError } from "../../server/errors";
import { parse, uuid } from "../../lib/validation";

/**
 * Áreas correlacionadas do Head (hierarquia de acessos, etapa 2): o diretor
 * marca, em Montar equipe, as outras áreas que cada Head acompanha. Nelas o
 * Head enxerga e age como na área dele. A RLS (migration
 * *_areas_correlacionadas, app.head_covers) confere de novo.
 */

/** As áreas correlacionadas de cada Head do evento, para o diretor (senão null). */
export async function listHeadAreas(actor: Actor, eventId: string): Promise<Record<string, string[]> | null> {
  if (!canGrantHeadAreas(actor, eventId)) return null;
  const rows = await actor.run((tx) => tx.headArea.findMany({ where: { eventId }, select: { participantId: true, areaId: true } }));
  const out: Record<string, string[]> = {};
  for (const r of rows) (out[r.participantId] ??= []).push(r.areaId);
  return out;
}

const schema = z.object({ areaIds: z.array(uuid).max(200) });

export async function setHeadAreas(actor: Actor, participantId: string, input: unknown) {
  const { areaIds } = parse(schema, input);
  const p = uuid.safeParse(participantId).success
    ? await actor.run((tx) => tx.participant.findFirst({ where: { id: participantId, deletedAt: null }, select: { id: true, eventId: true, role: true, areaId: true } }))
    : null;
  if (!p) throw new NotFoundError("Pessoa");
  if (!canGrantHeadAreas(actor, p.eventId)) throw new ForbiddenError("Só o diretor dá áreas correlacionadas ao Head");
  if (p.role !== "HEAD") throw new ValidationError("Só o Head tem áreas correlacionadas");

  return actor.run(async (tx) => {
    const areas = await tx.area.findMany({ where: { eventId: p.eventId, deletedAt: null, id: { in: areaIds } }, select: { id: true } });
    const next = areas.map((a) => a.id).filter((id) => id !== p.areaId).sort();
    if (next.length !== new Set(areaIds.filter((id) => id !== p.areaId)).size) throw new NotFoundError("Área");
    const before = (await tx.headArea.findMany({ where: { participantId: p.id }, select: { areaId: true } })).map((h) => h.areaId).sort();
    const add = next.filter((id) => !before.includes(id));
    const remove = before.filter((id) => !next.includes(id));
    if (remove.length) await tx.headArea.deleteMany({ where: { participantId: p.id, areaId: { in: remove } } });
    if (add.length) {
      await tx.headArea.createMany({ data: add.map((areaId) => ({ participantId: p.id, eventId: p.eventId, areaId, grantedById: actor.userId })) });
    }
    if (add.length || remove.length) {
      await audit(tx, actor, { eventId: p.eventId, entity: "head_areas", entityId: p.id, action: "UPDATE", before: { areaIds: before }, after: { areaIds: next } });
    }
    return { areaIds: next };
  });
}
