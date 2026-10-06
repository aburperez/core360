import { authed, body, query } from "@/server/http/handler";
import { createOccurrence, listOccurrences } from "@/modules/occurrences/occurrences.service";
import { getTeam } from "@/modules/teams/teams.service";
import { NotFoundError } from "@/server/errors";

export const GET = authed<{ eventId: string }>(({ req, actor, params }) =>
  listOccurrences(actor, params.eventId, query(req)),
);

export const POST = authed<{ eventId: string }>(async ({ req, actor, params }) => {
  const input = (await body(req)) as { teamId?: string };
  // O evento da URL precisa bater com o evento real da equipe.
  if (input.teamId) {
    const team = await getTeam(actor, input.teamId);
    if (team.eventId !== params.eventId) throw new NotFoundError("Equipe");
  }
  return createOccurrence(actor, input);
}, { status: 201 });
