import { z } from "zod";
import type { Actor, ClientView } from "../../server/authz/actor";
import { canGrantClientView } from "../../server/authz/policy";
import { audit } from "../../server/audit/audit";
import { ForbiddenError, NotFoundError, ValidationError } from "../../server/errors";
import { parse, uuid } from "../../lib/validation";

/**
 * Visão do cliente: o Gerente do evento (diretor ou executivo) ou o Admin
 * libera o que cada Cliente vê: custos, equipe e andamento (chamados e
 * planta). O Cliente só olha. A RLS (migration *_visao_cliente) confere de novo.
 */

const NONE: ClientView = { costs: false, team: false, progress: false };

/** O que cada Cliente do evento vê, para quem pode liberar (senão, vazio). */
export async function listClientViews(actor: Actor, eventId: string): Promise<Record<string, ClientView>> {
  if (!canGrantClientView(actor, eventId)) return {};
  const rows = await actor.run((tx) =>
    tx.clientView.findMany({ where: { eventId }, select: { participantId: true, costs: true, team: true, progress: true } }),
  );
  return Object.fromEntries(rows.map(({ participantId, ...v }) => [participantId, v]));
}

const schema = z.object({ costs: z.boolean(), team: z.boolean(), progress: z.boolean() }).partial();

export async function setClientView(actor: Actor, participantId: string, input: unknown) {
  const data = parse(schema, input);
  const p = uuid.safeParse(participantId).success
    ? await actor.run((tx) => tx.participant.findFirst({ where: { id: participantId, deletedAt: null }, select: { id: true, eventId: true, role: true } }))
    : null;
  if (!p) throw new NotFoundError("Pessoa");
  if (!canGrantClientView(actor, p.eventId)) throw new ForbiddenError();
  if (p.role !== "CLIENTE") throw new ValidationError("Só o Cliente tem visão de cliente");

  return actor.run(async (tx) => {
    const before = (await tx.clientView.findUnique({ where: { participantId: p.id }, select: { costs: true, team: true, progress: true } })) ?? NONE;
    const after = { ...before, ...data };
    await tx.clientView.upsert({
      where: { participantId: p.id },
      create: { eventId: p.eventId, participantId: p.id, ...after, updatedById: actor.userId },
      update: { ...after, updatedById: actor.userId },
    });
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      await audit(tx, actor, { eventId: p.eventId, entity: "client_view", entityId: p.id, action: "UPDATE", before: { ...before }, after: { ...after } });
    }
    return after;
  });
}
