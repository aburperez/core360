import { z } from "zod";
import type { Actor } from "../../server/authz/actor";
import { canGrantSections, canGrantSectionsFor, headCovers } from "../../server/authz/policy";
import { HEAD_SECTIONS, SECTIONS, isSection, type Section } from "../../server/authz/sections";
import { audit } from "../../server/audit/audit";
import { ForbiddenError, NotFoundError, ValidationError } from "../../server/errors";
import { parse, uuid } from "../../lib/validation";

/**
 * Caixas de acesso do Pré-produtor (hierarquia de acessos): o Gerente de
 * produção ou o diretor marca as partes da Pré-produção que cada Pré-produtor
 * abre; o Head marca as dos produtores da área dele, menos as de valores e do
 * cliente (etapa 2). A RLS (migrations *_acessos_pre_producao e
 * *_areas_correlacionadas) confere de novo.
 */

export interface ProducerBoxes {
  sections: Section[];
  /** As caixas que quem vê a tela pode mudar nesta pessoa. */
  editable: readonly Section[];
}

/** As caixas de cada Pré-produtor que quem vê a tela pode marcar (vazio: nenhum). */
export async function listProducerAccess(actor: Actor, eventId: string): Promise<Record<string, ProducerBoxes>> {
  const full = canGrantSections(actor, eventId);
  const rows = await actor.run((tx) =>
    tx.participant.findMany({
      where: { eventId, role: "PRE_PRODUTOR", deletedAt: null },
      select: { id: true, areaId: true, producerAccess: { select: { sections: true } } },
    }),
  );
  return Object.fromEntries(
    rows
      .filter((p) => full || headCovers(actor, eventId, p.areaId))
      .map((p) => [p.id, { sections: (p.producerAccess?.sections ?? []).filter(isSection), editable: full ? SECTIONS : HEAD_SECTIONS }]),
  );
}

const schema = z.object({ sections: z.array(z.enum(SECTIONS)).max(SECTIONS.length) });

export async function setProducerAccess(actor: Actor, participantId: string, input: unknown) {
  const { sections } = parse(schema, input);
  const p = uuid.safeParse(participantId).success
    ? await actor.run((tx) => tx.participant.findFirst({ where: { id: participantId, deletedAt: null }, select: { id: true, eventId: true, role: true, areaId: true } }))
    : null;
  if (!p) throw new NotFoundError("Pessoa");
  if (p.role !== "PRE_PRODUTOR") throw new ValidationError("Só o Pré-produtor tem caixas de acesso");
  if (!canGrantSectionsFor(actor, p.eventId, p)) {
    throw new ForbiddenError("Só o Gerente de produção, o diretor e o Head da área liberam as partes da Pré-produção");
  }
  const full = canGrantSections(actor, p.eventId);

  return actor.run(async (tx) => {
    const before = ((await tx.producerAccess.findUnique({ where: { participantId: p.id }, select: { sections: true } }))?.sections ?? []).filter(isSection);
    // O Head só mexe nas HEAD_SECTIONS: as outras ficam como estavam.
    const next = SECTIONS.filter((s) => (full || HEAD_SECTIONS.includes(s) ? sections.includes(s) : before.includes(s)));
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
