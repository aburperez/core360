import { authed, body } from "@/server/http/handler";
import { setHeadAreas } from "@/modules/participants/head-areas.service";

/** Áreas correlacionadas que o Head acompanha (só o diretor): { areaIds: [...] }. */
export const PUT = authed<{ participantId: string }>(async ({ req, actor, params }) =>
  setHeadAreas(actor, params.participantId, await body(req)),
);
