import type { Tx } from "../../server/db/with-user";
import { ITEM_STATUSES, type ItemStatus } from "../items/item-meta";

/**
 * Prazo de montagem dos itens (fase 5B): o item que está no mapa de montagem
 * precisa estar Montado até o fim da montagem da chegada dele (ou, sem fim
 * marcado, até o início do evento). Em mais de uma chegada, vale a primeira.
 * Só a Pré-produção usa (cronograma e central de pendências).
 */
export async function assemblyDeadlines(tx: Tx, eventId: string, eventStart: Date) {
  const rows = await tx.arrivalItem.findMany({
    where: { costItemId: { not: null }, arrival: { eventId } },
    select: { costItemId: true, arrival: { select: { endsAt: true } } },
  });
  const map = new Map<string, Date>();
  for (const r of rows) {
    const until = r.arrival.endsAt ?? eventStart;
    const prev = map.get(r.costItemId!);
    if (!prev || until < prev) map.set(r.costItemId!, until);
  }
  return map;
}

/** Já montado (ou além): Montado, Conferido ou Finalizado. */
export const itemAssembled = (s: ItemStatus) => ITEM_STATUSES.indexOf(s) >= ITEM_STATUSES.indexOf("MONTADO");
