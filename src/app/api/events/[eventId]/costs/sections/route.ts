import { authed, body } from "@/server/http/handler";
import { createCostSection } from "@/modules/costs/costs.service";

export const POST = authed<{ eventId: string }>(async ({ req, actor, params }) =>
  createCostSection(actor, params.eventId, await body(req)),
{ status: 201 });
