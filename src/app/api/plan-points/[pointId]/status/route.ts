import { authed, body } from "@/server/http/handler";
import { setPointStatus } from "@/modules/floorplans/floorplans.service";

/** Iniciar, concluir ou desfazer a etapa. */
export const POST = authed<{ pointId: string }>(async ({ req, actor, params }) => setPointStatus(actor, params.pointId, await body(req)));
