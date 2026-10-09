import { authed, body } from "@/server/http/handler";
import { deleteArrival, updateArrival } from "@/modules/arrivals/arrivals.service";

/** Muda horário, veículo, doca, área, responsável e itens (Pré-produção). */
export const PATCH = authed<{ arrivalId: string }>(async ({ req, actor, params }) => updateArrival(actor, params.arrivalId, await body(req)));

export const DELETE = authed<{ arrivalId: string }>(({ actor, params }) => deleteArrival(actor, params.arrivalId));
