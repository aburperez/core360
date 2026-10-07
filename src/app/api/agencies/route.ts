import { authed, body } from "@/server/http/handler";
import { createAgency, listAgencies } from "@/modules/agencies/agencies.service";

/** Só o Admin da plataforma. */
export const GET = authed(({ actor }) => listAgencies(actor));
export const POST = authed(async ({ req, actor }) => createAgency(actor, await body(req)), { status: 201 });
