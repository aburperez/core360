import { authed } from "@/server/http/handler";
import { createAgencyAdminInvitation } from "@/modules/agencies/agencies.service";

export const POST = authed<{ adminId: string }>(
  ({ actor, params }) => createAgencyAdminInvitation(actor, params.adminId),
  { status: 201 },
);
