import { authed, body } from "@/server/http/handler";
import { setArrivalStatus } from "@/modules/arrivals/arrivals.service";

/** Status da chegada: { status } (o campo e a Pré-produção). */
export const POST = authed<{ arrivalId: string }>(async ({ req, actor, params }) => setArrivalStatus(actor, params.arrivalId, await body(req)));
