import { authed, body } from "@/server/http/handler";
import { updateAgencyAdmin } from "@/modules/agencies/agencies.service";

export const PATCH = authed<{ adminId: string }>(async ({ req, actor, params }) => updateAgencyAdmin(actor, params.adminId, await body(req)));
