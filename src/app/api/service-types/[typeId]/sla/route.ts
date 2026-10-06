import { authed, body } from "@/server/http/handler";
import { proposeSla } from "@/modules/service-types/service-types.service";

/** Quem executa propõe o SLA; o gestor define direto. */
export const POST = authed<{ typeId: string }>(async ({ req, actor, params }) =>
  proposeSla(actor, params.typeId, await body(req)),
{ status: 201 });
