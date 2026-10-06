import { authed, body } from "@/server/http/handler";
import { deleteCostItem, updateCostItem } from "@/modules/costs/costs.service";

export const PATCH = authed<{ itemId: string }>(async ({ req, actor, params }) =>
  updateCostItem(actor, params.itemId, await body(req)),
);

export const DELETE = authed<{ itemId: string }>(({ actor, params }) => deleteCostItem(actor, params.itemId));
