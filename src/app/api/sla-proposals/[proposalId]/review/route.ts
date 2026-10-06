import { authed, body } from "@/server/http/handler";
import { reviewSla } from "@/modules/service-types/service-types.service";

/** O gestor aprova, ajusta ou recusa a proposta de SLA, com comentário. */
export const POST = authed<{ proposalId: string }>(async ({ req, actor, params }) =>
  reviewSla(actor, params.proposalId, await body(req)),
);
