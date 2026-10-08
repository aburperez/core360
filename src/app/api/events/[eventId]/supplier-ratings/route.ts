import { authed } from "@/server/http/handler";
import { listEventRatings } from "@/modules/suppliers/ratings.service";

/** Fornecedores com contrato assinado no evento e as notas deles (só o diretor). */
export const GET = authed<{ eventId: string }>(({ actor, params }) => listEventRatings(actor, params.eventId));
