import { authed, body } from "@/server/http/handler";
import { addAgencyAdmin } from "@/modules/agencies/agencies.service";

export const POST = authed<{ agencyId: string }>(
  async ({ req, actor, params }) => addAgencyAdmin(actor, params.agencyId, await body(req)),
  { status: 201 },
);
