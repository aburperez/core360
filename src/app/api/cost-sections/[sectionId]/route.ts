import { authed, body } from "@/server/http/handler";
import { deleteCostSection, updateCostSection } from "@/modules/costs/costs.service";

export const PATCH = authed<{ sectionId: string }>(async ({ req, actor, params }) =>
  updateCostSection(actor, params.sectionId, await body(req)),
);

export const DELETE = authed<{ sectionId: string }>(({ actor, params }) => deleteCostSection(actor, params.sectionId));
