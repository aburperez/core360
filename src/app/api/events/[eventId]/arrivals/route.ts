import { authed, body } from "@/server/http/handler";
import { createArrival, listArrivals } from "@/modules/arrivals/arrivals.service";

/** Mapa de montagem: as chegadas que a pessoa vê. */
export const GET = authed<{ eventId: string }>(({ actor, params }) => listArrivals(actor, params.eventId));

/** Nova chegada (Pré-produção). */
export const POST = authed<{ eventId: string }>(async ({ req, actor, params }) => createArrival(actor, params.eventId, await body(req)), { status: 201 });
