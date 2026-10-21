import type { Actor } from "../../server/authz/actor";
import { productionArea } from "../../server/authz/policy";
import { ValidationError } from "../../server/errors";

/**
 * Pré-produção por área (2026-10-21): o Pré-produtor ligado a uma área só
 * grava na área dele. Aqui só para dar uma mensagem clara; a RLS
 * (migration *_producao_por_area) barra de qualquer jeito.
 */

/** A área que entra quando a pessoa não escolheu: a dela, se tiver. */
export function defaultArea(actor: Actor, eventId: string, areaId: string | null | undefined) {
  return areaId ?? productionArea(actor, eventId);
}

/** Barra mudar para outra área. eventWide: "sem área" (o evento todo) também vale. */
export function assertProductionArea(actor: Actor, eventId: string, areaId: string | null | undefined, eventWide = false) {
  const mine = productionArea(actor, eventId);
  if (!mine || areaId === undefined || areaId === mine || (eventWide && areaId === null)) return;
  throw new ValidationError("Você trabalha só na sua área da pré-produção", { areaId: ["Escolha a sua área"] });
}
