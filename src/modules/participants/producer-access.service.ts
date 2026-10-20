import { z } from "zod";
import type { Actor } from "../../server/authz/actor";
import { canGrantSections } from "../../server/authz/policy";
import { SECTIONS, isSection, type Section } from "../../server/authz/sections";
import { audit } from "../../server/audit/audit";
import { ForbiddenError, NotFoundError, ValidationError } from "../../server/errors";
import { parse, uuid } from "../../lib/validation";

/**
 * Caixas de acesso do Pré-produtor (hierarquia de acessos, 2026-10-20): o
 * Gerente de produção ou o diretor marca as partes da Pré-produção que cada
 * Pré-produtor abre. A RLS (migration *_acessos_pre_producao) confere de novo.
 */

/** As caixas de cada Pré-produtor do evento, para quem pode marcar (senão null). */
export async function listProducerAccess(actor: Actor, eventId: string): Promise<Record<string, Section[]> | null> {
  if (!canGrantSections(actor, eventId)) return null;
  const rows = await actor.run((tx) => tx.producerAccess.findMany({ where: { eventId }, select: { participantId: true, sections: true } }));
  return Object.fromEntries(rows.map((r) => [r.participantId, r.sections.filter(isSection)]));
}

const schema = z.object({ sections: z.array(z.enum(SECTIONS)).max(SECTIONS.length) });

export async function setProducerAccess(actor: Actor, participantId: string, input: unknown) {
  const { sections } = parse(schema, input);
  const p = uuid.safeParse(participantId).success
    ? await actor.run((tx) => tx.participant.findFirst({ where: { id: participantId, deletedAt: null }, select: { id: true, eventId: true, role: true } }))
    : null;
  if (!p) throw new NotFoundError("Pessoa");
  if (!canGrantSections(actor, p.eventId)) throw new ForbiddenError("Só o Gerente de produção e o diretor liberam as partes da Pré-produção");
  if (p.role !== "PRE_PRODUTOR") throw new ValidationError("Só o Pré-produtor tem caixas de acesso");
  const next = SECTIONS.filter((s) => sections.includes(s));

  return actor.run(async (tx) => {
    const before = (await tx.producerAccess.findUnique({ where: { participantId: p.id }, select: { sections: true } }))?.sections ?? [];
    await tx.producerAccess.upsert({
      where: { participantId: p.id },
      create: { eventId: p.eventId, participantId: p.id, sections: next, updatedById: actor.userId },
      update: { sections: next, updatedById: actor.userId },
    });
    if ([...before].sort().join() !== [...next].sort().join()) {
      await audit(tx, actor, { eventId: p.eventId, entity: "producer_access", entityId: p.id, action: "UPDATE", before: { sections: before }, after: { sections: next } });
    }
    return { sections: next };
  });
}
