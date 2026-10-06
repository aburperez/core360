import { authed, body } from "@/server/http/handler";
import { createArea, listAreas } from "@/modules/areas/areas.service";

export const GET = authed<{ eventId: string }>(({ actor, params }) => listAreas(actor, params.eventId));
export const POST = authed<{ eventId: string }>(
  async ({ req, actor, params }) => createArea(actor, { ...(await body(req) as object), eventId: params.eventId }),
  { status: 201 },
);
