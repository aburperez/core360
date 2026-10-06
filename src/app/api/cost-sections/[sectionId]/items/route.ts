import { authed, body } from "@/server/http/handler";
import { createCostItem } from "@/modules/costs/costs.service";

export const POST = authed<{ sectionId: string }>(async ({ req, actor, params }) =>
  createCostItem(actor, params.sectionId, await body(req)),
{ status: 201 });
