import { authed } from "@/server/http/handler";
import { createDirectorInvitation } from "@/modules/directors/directors.service";

/** Um convite só para o diretor entrar em todos os eventos. */
export const POST = authed<{ directorId: string }>(
  ({ actor, params }) => createDirectorInvitation(actor, params.directorId),
  { status: 201 },
);
