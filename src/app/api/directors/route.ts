import { authed, body } from "@/server/http/handler";
import { createDirector, listDirectors } from "@/modules/directors/directors.service";

export const GET = authed(({ req, actor }) => listDirectors(actor, new URL(req.url).searchParams.get("agencia")));
export const POST = authed(async ({ req, actor }) => createDirector(actor, await body(req)), { status: 201 });
