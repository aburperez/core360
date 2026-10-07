import { authed, body } from "@/server/http/handler";
import { createClient, listClients } from "@/modules/clients/clients.service";

export const GET = authed(({ req, actor }) => listClients(actor, new URL(req.url).searchParams.get("agencia")));
export const POST = authed(async ({ req, actor }) => createClient(actor, await body(req)), { status: 201 });
