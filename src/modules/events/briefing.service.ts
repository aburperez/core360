import { z } from "zod";
import type { Actor } from "../../server/authz/actor";
import { canUsePreProduction } from "../../server/authz/policy";
import { audit, diff } from "../../server/audit/audit";
import { NotFoundError } from "../../server/errors";
import { optionalText, parse } from "../../lib/validation";
import { BRIEFING_BLOCKS, BRIEFING_FRONTS, BRIEFING_TEXT_KEYS, type BriefingFrontKey, type BriefingTextKey } from "../../lib/event-briefing";
import { requireEventAccess } from "./events.service";

/**
 * Briefing do evento: o que o cliente pediu (cliente, evento, local) e, para
 * cada uma das 13 frentes de estrutura, se precisa e uma observação. Nome,
 * tipo, público estimado, local e endereço ficam na ficha do evento, que é a
 * fonte única. Só a Pré-produção (Gerente, Pré-produtor e Admin) vê e
 * preenche; a RLS da migration *_briefing_evento repete a regra no banco.
 */

function requirePre(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canUsePreProduction(actor, eventId)) throw new NotFoundError("Pré-produção");
}

export type BriefingFrontRow = { key: BriefingFrontKey; label: string; needed: boolean | null; notes: string | null };

/** O briefing com as 13 frentes sempre na ordem (frente sem resposta = a definir). */
export async function getEventBriefing(actor: Actor, eventId: string) {
  requirePre(actor, eventId);
  return actor.run(async (tx) => {
    const [b, rows] = await Promise.all([
      tx.eventBriefing.findUnique({ where: { eventId } }),
      tx.eventBriefingFront.findMany({ where: { eventId } }),
    ]);
    const byKey = new Map(rows.map((r) => [r.front as string, r]));
    const fronts: BriefingFrontRow[] = BRIEFING_FRONTS.map((f) => ({
      key: f.key, label: f.label, needed: byKey.get(f.key)?.needed ?? null, notes: byKey.get(f.key)?.notes ?? null,
    }));
    const text = Object.fromEntries(BRIEFING_TEXT_KEYS.map((k) => [k, b?.[k] ?? null])) as Record<BriefingTextKey, string | null>;
    const answered = fronts.filter((f) => f.needed !== null).length;
    const filled = BRIEFING_TEXT_KEYS.filter((k) => text[k]).length;
    return {
      ...text, fronts, updatedAt: b?.updatedAt ?? null,
      progress: { answered, needed: fronts.filter((f) => f.needed).length, filled, fields: BRIEFING_TEXT_KEYS.length },
    };
  });
}

const textSchema = z.object(
  Object.fromEntries(BRIEFING_BLOCKS.flatMap((b) => b.fields.map((f) => [f.key, optionalText(f.max)]))) as Record<
    BriefingTextKey, ReturnType<typeof optionalText>
  >,
);
const frontSchema = z.object({
  key: z.enum(BRIEFING_FRONTS.map((f) => f.key) as [BriefingFrontKey, ...BriefingFrontKey[]]),
  needed: z.boolean().nullable(),
  notes: optionalText(2000),
});
const saveSchema = textSchema.partial().extend({ fronts: z.array(frontSchema).max(BRIEFING_FRONTS.length).optional() });

/** Salvar o briefing. Só os campos enviados mudam; as frentes enviadas são gravadas uma a uma. */
export async function saveEventBriefing(actor: Actor, eventId: string, input: unknown) {
  requirePre(actor, eventId);
  const { fronts, ...data } = parse(saveSchema, input);
  const sent = (input ?? {}) as Record<string, unknown>;
  const patch = Object.fromEntries(Object.entries(data).filter(([k]) => k in sent)) as Partial<Record<BriefingTextKey, string | null>>;
  return actor.run(async (tx) => {
    const before = await tx.eventBriefing.findUnique({ where: { eventId } });
    const changes = diff((before ?? {}) as Record<string, unknown>, patch);
    const textChanged = Object.keys(changes.after).length > 0;
    const oldFronts = new Map((await tx.eventBriefingFront.findMany({ where: { eventId } })).map((r) => [r.front as string, r]));
    for (const f of fronts ?? []) {
      const old = oldFronts.get(f.key);
      if ((old?.needed ?? null) === f.needed && (old?.notes ?? null) === f.notes) continue;
      await tx.eventBriefingFront.upsert({
        where: { eventId_front: { eventId, front: f.key } },
        create: { eventId, front: f.key, needed: f.needed, notes: f.notes },
        update: { needed: f.needed, notes: f.notes },
      });
      changes.before[`front.${f.key}`] = old ? { needed: old.needed, notes: old.notes } : null;
      changes.after[`front.${f.key}`] = { needed: f.needed, notes: f.notes };
    }
    // A data e quem mexeu por último mudam a cada alteração, de texto ou de frente.
    if (Object.keys(changes.after).length) {
      await tx.eventBriefing.upsert({
        where: { eventId },
        create: { eventId, ...patch, updatedById: actor.userId },
        update: { ...(textChanged ? patch : {}), updatedById: actor.userId, updatedAt: new Date() },
      });
    }
    if (Object.keys(changes.after).length) {
      await audit(tx, actor, { eventId, entity: "event_briefing", entityId: eventId, action: before ? "UPDATE" : "CREATE", ...changes });
    }
    return { eventId };
  });
}
