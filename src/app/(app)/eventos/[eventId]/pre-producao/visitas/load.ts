import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { NotFoundError } from "@/server/errors";
import { PLACE_FIELDS, getVisitReport } from "@/modules/visits/report.service";
import type { VisitData } from "./report-forms";

/** A visita com o relatório, para a página e o relatório; quem não pode ver recebe 404. */
export async function loadVisitData(eventId: string, visitId: string) {
  const actor = await requireUser();
  const v = await getVisitReport(actor, visitId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  if (v.eventId !== eventId) notFound();
  const data: VisitData = {
    id: v.id, eventId: v.eventId, address: v.address, people: v.people, status: v.status, canEdit: v.canEdit,
    fields: Object.fromEntries(PLACE_FIELDS.map((f) => [f.key, v[f.key]])), photos: v.photos,
  };
  return { actor, visit: v, data };
}
