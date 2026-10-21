import { z } from "zod";
import type { Actor } from "../../server/authz/actor";
import { canManageAreas, canSeeArea } from "../../server/authz/policy";
import { audit } from "../../server/audit/audit";
import { ForbiddenError, NotFoundError, ValidationError } from "../../server/errors";
import { optionalText, parse, text, uuid } from "../../lib/validation";
import { requireEventAccess } from "../events/events.service";
import { isUniqueViolation } from "../../server/db/errors";
import { DEFAULT_FUNCTIONS } from "../functions/functions.service";

export async function listAreas(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  const areas = await actor.run((tx) =>
    tx.area.findMany({
      where: { eventId, deletedAt: null },
      orderBy: { name: "asc" },
      include: { _count: { select: { teams: { where: { deletedAt: null } } } } },
    }),
  );
  return areas.filter((a) => canSeeArea(actor, { eventId, areaId: a.id }));
}

export async function getArea(actor: Actor, areaId: string) {
  const area = uuid.safeParse(areaId).success
    ? await actor.run((tx) => tx.area.findFirst({ where: { id: areaId, deletedAt: null } }))
    : null;
  if (!area || !canSeeArea(actor, { eventId: area.eventId, areaId: area.id })) throw new NotFoundError("Área");
  return area;
}

const createAreaSchema = z.object({ eventId: uuid, name: text(80), description: optionalText() });

export async function createArea(actor: Actor, input: unknown) {
  const data = parse(createAreaSchema, input);
  requireEventAccess(actor, data.eventId);
  if (!canManageAreas(actor, data.eventId)) throw new ForbiddenError();
  try {
    return await actor.run(async (tx) => {
      const area = await tx.area.create({ data });
      await audit(tx, actor, { eventId: data.eventId, entity: "area", entityId: area.id, action: "CREATE", after: data });
      return area;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ValidationError(`Já existe uma área "${data.name}" neste evento`);
    throw e;
  }
}

export const normName = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** "Infra" e "Infraestrutura", "Operação" e "Operações": a mesma área com outro nome. */
const sameArea = (a: string, b: string) => a === b || a.startsWith(b) || b.startsWith(a) || (a.length >= 6 && b.length >= 6 && a.slice(0, 6) === b.slice(0, 6));

/**
 * Áreas da produção (2026-10-21): cria as áreas do evento a partir da lista
 * de Produtores e Funções (a do evento ou, sem ela, a padrão) e Cenografia,
 * que o Abu pediu junto. As que já existem, mesmo com outro nome parecido
 * ("Infra" e "Infraestrutura"), ficam como estão.
 */
export async function createProducerAreas(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canManageAreas(actor, eventId)) throw new ForbiddenError();
  return actor.run(async (tx) => {
    const fns = await tx.eventFunction.findMany({ where: { eventId }, orderBy: { name: "asc" }, select: { name: true } });
    const names = [...(fns.length ? fns.map((f) => f.name) : DEFAULT_FUNCTIONS), "Cenografia"];
    const have = (await tx.area.findMany({ where: { eventId, deletedAt: null }, select: { name: true } })).map((a) => normName(a.name));
    const created: string[] = [];
    for (const name of names) {
      if (have.some((h) => sameArea(h, normName(name)))) continue;
      have.push(normName(name));
      const area = await tx.area.create({ data: { eventId, name } });
      await audit(tx, actor, { eventId, entity: "area", entityId: area.id, action: "CREATE", after: { name, from: "lista de produtores" } });
      created.push(name);
    }
    return { created };
  });
}
