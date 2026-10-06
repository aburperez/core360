import { authed, body } from "@/server/http/handler";
import { getCostSheet, updateCostSheet } from "@/modules/costs/costs.service";

export const GET = authed<{ eventId: string }>(({ actor, params }) => getCostSheet(actor, params.eventId));

/** Cabeçalho e percentuais (honorários e encargos). */
export const PATCH = authed<{ eventId: string }>(async ({ req, actor, params }) =>
  updateCostSheet(actor, params.eventId, await body(req)),
);
