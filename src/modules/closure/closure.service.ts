import { zipSync, strToU8, type Zippable } from "fflate";
import { z } from "zod";
import { isEventAdmin, isEventSupport, membershipFor, type Actor } from "../../server/authz/actor";
import { audit } from "../../server/audit/audit";
import { pgErrorCode } from "../../server/db/errors";
import { ConflictError, NotFoundError, ValidationError } from "../../server/errors";
import { getStorage } from "../../server/storage/storage";
import { parse } from "../../lib/validation";
import { formatPeriod } from "../../lib/format";
import { requireEventAccess, getEvent } from "../events/events.service";
import { getBudget } from "../items/budget.service";
import { listEventRatings } from "../suppliers/ratings.service";
import { REPORT_KEYS, REPORTS } from "../reports/catalog";
import { buildReport } from "../reports/build.service";
import { reportFileName, writeReportXlsx } from "../reports/report-xlsx";
import { exportDailyReport, getDailyReport } from "../reports/reports.service";

/**
 * Fase 6C: histórico e encerramento. Com o evento Concluído, o diretor baixa
 * o histórico (ZIP em partes, por causa do limite de download da
 * hospedagem) e depois encerra: o banco (app.close_event) confere tudo de
 * novo, guarda só o resumo e apaga fotos, arquivos e pessoas. Nada se apaga
 * sozinho.
 */

/** Cada parte do ZIP fica abaixo do limite de resposta da Vercel (4,5 MB). */
export const PART_LIMIT_BYTES = 3_500_000;
/** Espaço reservado na parte 1 para os relatórios em Excel (gerados na hora). */
const REPORTS_RESERVE_BYTES = 400_000;

/** Quem encerra: o Gerente do evento (os diretores entram como Gerente) ou o Admin da agência (não o Suporte). */
export function canCloseEvent(actor: Actor, eventId: string) {
  if (isEventAdmin(actor, eventId) && !isEventSupport(actor, eventId)) return true;
  return membershipFor(actor, eventId)?.role === "GERENTE";
}

function requireCloser(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canCloseEvent(actor, eventId)) throw new NotFoundError("Encerramento");
}

// ───────────────────────────── arquivos do histórico ─────────────────────────────

type StoredEntry = { path: string; size: number; key: string };

const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

/** Nome seguro para dentro do ZIP (sem barras nem caracteres que o Windows recusa). */
const safe = (s: string, max = 60) =>
  s.normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) || "arquivo";

const withExt = (name: string, mime: string) => {
  const ext = EXT[mime];
  return ext && !name.toLowerCase().endsWith(`.${ext}`) ? `${name}.${ext}` : name;
};

/** Todos os arquivos guardados do evento, com o caminho dentro do ZIP. */
async function storedFiles(actor: Actor, eventId: string): Promise<StoredEntry[]> {
  const d = await actor.run(async (tx) => {
    const [documents, quotes, plans, attachments, receipts, visits, points] = await Promise.all([
      tx.eventDocument.findMany({ where: { eventId }, orderBy: { createdAt: "asc" }, select: { id: true, title: true, fileName: true, mimeType: true, sizeBytes: true, storageKey: true } }),
      tx.supplierQuote.findMany({
        where: { eventId, fileKey: { not: null } },
        orderBy: { createdAt: "asc" },
        select: { id: true, companyName: true, fileName: true, fileMime: true, fileSize: true, fileKey: true, request: { select: { title: true } } },
      }),
      tx.floorPlan.findMany({ where: { eventId }, orderBy: { position: "asc" }, select: { id: true, name: true, mimeType: true, sizeBytes: true, storageKey: true } }),
      tx.attachment.findMany({
        where: { eventId, deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: { id: true, mimeType: true, sizeBytes: true, storageKey: true, occurrence: { select: { number: true } } },
      }),
      tx.receiptPhoto.findMany({
        where: { eventId },
        orderBy: { createdAt: "asc" },
        select: { id: true, mimeType: true, sizeBytes: true, storageKey: true, receipt: { select: { name: true } } },
      }),
      tx.technicalVisitPhoto.findMany({
        where: { eventId },
        orderBy: [{ visitId: "asc" }, { position: "asc" }],
        select: { id: true, mimeType: true, sizeBytes: true, storageKey: true, position: true, visit: { select: { title: true } } },
      }),
      tx.planPointPhoto.findMany({ where: { eventId }, orderBy: { createdAt: "asc" }, select: { id: true, mimeType: true, sizeBytes: true, storageKey: true } }),
    ]);
    return { documents, quotes, plans, attachments, receipts, visits, points };
  });
  const id8 = (id: string) => id.slice(-8);
  return [
    ...d.documents.map((x) => ({ path: `documentos/${withExt(safe(x.fileName || x.title, 80), x.mimeType)}`, size: x.sizeBytes, key: x.storageKey })),
    ...d.quotes.map((x) => ({
      path: `orcamentos/${safe(x.request.title, 40)} - ${safe(x.companyName, 40)} - ${withExt(safe(x.fileName ?? id8(x.id), 50), x.fileMime ?? "")}`,
      size: x.fileSize ?? 0, key: x.fileKey!,
    })),
    ...d.plans.map((x) => ({ path: `planta/${withExt(safe(x.name), x.mimeType)}`, size: x.sizeBytes, key: x.storageKey })),
    ...d.attachments.map((x) => ({ path: `fotos/chamados/chamado ${x.occurrence.number} - ${id8(x.id)}.${EXT[x.mimeType] ?? "jpg"}`, size: x.sizeBytes, key: x.storageKey })),
    ...d.receipts.map((x) => ({ path: `fotos/recebimentos/${safe(x.receipt.name, 50)} - ${id8(x.id)}.${EXT[x.mimeType] ?? "jpg"}`, size: x.sizeBytes, key: x.storageKey })),
    ...d.visits.map((x) => ({ path: `fotos/visitas/${safe(x.visit.title, 50)}/${String(x.position + 1).padStart(2, "0")} - ${id8(x.id)}.${EXT[x.mimeType] ?? "jpg"}`, size: x.sizeBytes, key: x.storageKey })),
    ...d.points.map((x) => ({ path: `fotos/planta/${id8(x.id)}.${EXT[x.mimeType] ?? "jpg"}`, size: x.sizeBytes, key: x.storageKey })),
  ];
}

/** Divide os arquivos em partes; a parte 1 sempre leva os relatórios. */
export function splitParts<T extends { size: number }>(files: T[], limit = PART_LIMIT_BYTES, reserve = REPORTS_RESERVE_BYTES) {
  const parts: T[][] = [[]];
  let used = reserve;
  for (const f of files) {
    if (used + f.size > limit && (parts.at(-1)!.length > 0 || parts.length > 1 || used > reserve)) {
      parts.push([]);
      used = 0;
    }
    parts.at(-1)!.push(f);
    used += f.size;
  }
  return parts;
}

const PART_LABEL = (files: StoredEntry[], first: boolean) => {
  const kinds = new Set(files.map((f) => f.path.split("/")[0]));
  const names: string[] = [];
  if (first) names.push("relatórios");
  if (kinds.has("documentos") || kinds.has("orcamentos") || kinds.has("planta")) names.push("documentos e orçamentos");
  if (kinds.has("fotos")) names.push("fotos");
  return names.join(", ").replace(/, ([^,]*)$/, " e $1");
};

// ───────────────────────────── telas ─────────────────────────────

/** A página de encerramento: situação, partes do histórico e o que já foi feito. */
export async function getClosure(actor: Actor, eventId: string) {
  requireCloser(actor, eventId);
  const [event, archive, files] = await Promise.all([
    getEvent(actor, eventId),
    actor.run((tx) =>
      tx.eventArchive.findUnique({
        where: { eventId },
        select: { concludedAt: true, historyDownloadedAt: true, closedAt: true, downloadedBy: { select: { name: true } } },
      }),
    ),
    storedFiles(actor, eventId),
  ]);
  const parts = splitParts(files).map((p, i) => ({
    n: i + 1,
    label: PART_LABEL(p, i === 0),
    files: p.length + (i === 0 ? REPORT_KEYS.length : 0),
    bytes: p.reduce((s, f) => s + f.size, 0) + (i === 0 ? REPORTS_RESERVE_BYTES / 4 : 0),
  }));
  return {
    event: { id: event.id, name: event.name, status: event.status },
    archive: archive && {
      concludedAt: archive.concludedAt,
      downloadedAt: archive.historyDownloadedAt,
      downloadedBy: archive.downloadedBy?.name ?? null,
      closed: !!archive.closedAt,
    },
    parts,
    totals: { files: files.length, bytes: files.reduce((s, f) => s + f.size, 0) },
  };
}

/** Uma parte do histórico em ZIP. Baixar marca o histórico como baixado. */
export async function historyPart(actor: Actor, eventId: string, partParam: string | number) {
  requireCloser(actor, eventId);
  const event = await getEvent(actor, eventId);
  const archive = await actor.run((tx) => tx.eventArchive.findUnique({ where: { eventId }, select: { closedAt: true } }));
  if (event.status !== "CONCLUIDO" || !archive || archive.closedAt) throw new ConflictError("O histórico sai quando o evento está Concluído");

  const parts = splitParts(await storedFiles(actor, eventId));
  const n = Number(partParam);
  if (!Number.isInteger(n) || n < 1 || n > parts.length) throw new NotFoundError("Parte do histórico");

  const zip: Zippable = {};
  const storage = getStorage();
  const read = async (key: string) => {
    if (storage.inDatabase) return actor.run((tx) => storage.get!(key, tx));
    if (storage.fetch) return storage.fetch(key);
    return storage.get?.(key);
  };
  const missing: string[] = [];
  for (const f of parts[n - 1]!) {
    const body = await read(f.key);
    if (body) zip[f.path] = [body, { level: 0 }];
    else missing.push(f.path);
  }

  if (n === 1) {
    for (const key of REPORT_KEYS) {
      const r = await buildReport(actor, eventId, key);
      zip[`relatorios/${reportFileName(r)}`] = [await writeReportXlsx(r), { level: 0 }];
    }
    const daily = await getDailyReport(actor, eventId);
    for (const day of daily.days) {
      const x = await exportDailyReport(actor, eventId, day);
      zip[`relatorios/diarios/${day}.xlsx`] = [x.bytes, { level: 0 }];
    }
  }
  zip["LEIA-ME.txt"] = strToU8(readme(event, n, parts.length, missing));

  await actor.run(async (tx) => {
    await tx.$executeRaw`SELECT app.mark_history_downloaded(${eventId}::uuid)`;
    await audit(tx, actor, { eventId, entity: "event_history", entityId: eventId, action: "UPDATE", after: { part: n, of: parts.length } });
  });
  const name = `Historico - ${event.name}`.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/["\\/]/g, "").slice(0, 80);
  return { fileName: `${name} - parte ${n} de ${parts.length}.zip`, bytes: zipSync(zip) };
}

function readme(event: { name: string; startsAt: Date; endsAt: Date; timezone: string }, n: number, total: number, missing: string[]) {
  return [
    `Histórico do evento: ${event.name}`,
    `Datas: ${formatPeriod(event.startsAt, event.endsAt, event.timezone, true)}`,
    `Parte ${n} de ${total}. Baixe e guarde todas as partes antes de encerrar o evento no CORE 360.`,
    "",
    n === 1 ? "Nesta parte: os relatórios em Excel (pasta relatorios), os documentos, os orçamentos e a planta." : "Nesta parte: fotos e arquivos que não couberam nas partes anteriores.",
    "Os relatórios também podem ser salvos em PDF pela tela Relatórios do app, enquanto o evento não for encerrado.",
    ...(missing.length ? ["", "Arquivos que não foram encontrados no armazenamento:", ...missing.map((m) => `- ${m}`)] : []),
    "",
  ].join("\r\n");
}

// ───────────────────────────── encerrar ─────────────────────────────

export type ClosureSummary = {
  name: string;
  client: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  venue: string | null;
  totals: { items: number; estimated: number; quoted: number; contracted: number; actual: number; saving: number; overrun: number };
  approved: number | null;
  ratings: { supplier: string; average: number | null; ratings: number }[];
  counts: { people: number; occurrences: number; suppliers: number; files: number };
};

async function buildSummary(actor: Actor, eventId: string): Promise<ClosureSummary> {
  const [event, budget, ratings, counts, files] = await Promise.all([
    getEvent(actor, eventId),
    getBudget(actor, eventId),
    listEventRatings(actor, eventId),
    actor.run(async (tx) => ({
      people: await tx.participant.count({ where: { eventId, deletedAt: null, role: { not: "CLIENTE" } } }),
      occurrences: (await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM app.report_occurrences(${eventId}::uuid)`)[0]!.n,
    })),
    storedFiles(actor, eventId),
  ]);
  const t = budget.totals;
  return {
    name: event.name,
    client: event.client.name,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    timezone: event.timezone,
    venue: [event.venue, event.city, event.state].filter(Boolean).join(" · ") || null,
    totals: { items: t.items, estimated: t.estimated, quoted: t.quoted, contracted: t.contracted, actual: t.actual, saving: t.saving, overrun: t.overrun },
    approved: budget.approved.value,
    ratings: ratings.items.map((r) => ({ supplier: r.name, average: r.eventAverage, ratings: (r.rating ? 1 : 0) + r.others.length })),
    counts: { people: counts.people, occurrences: Number(counts.occurrences), suppliers: ratings.items.length, files: files.length },
  };
}

const closeSchema = z.object({
  confirm: z.string().max(300),
  savedAllParts: z.literal(true, { message: "Confirme que baixou e guardou todas as partes" }),
});

/** Encerrar e apagar: guarda o resumo e apaga o resto. Não tem volta. */
export async function closeEvent(actor: Actor, eventId: string, input: unknown) {
  requireCloser(actor, eventId);
  const data = parse(closeSchema, input);
  const summary = await buildSummary(actor, eventId);
  let keys: string[];
  try {
    keys = await actor.run(async (tx) => {
      const [r] = await tx.$queryRaw<{ keys: string[] }[]>`
        SELECT app.close_event(${eventId}::uuid, ${data.confirm}, ${JSON.stringify(summary)}::jsonb) AS keys`;
      await audit(tx, actor, {
        eventId, entity: "event", entityId: eventId, action: "DELETE",
        after: { closed: true, files: r!.keys.length, name: summary.name },
      });
      return r!.keys;
    });
  } catch (e) {
    if (pgErrorCode(e) === "23514") {
      const msg = String((e as { message?: string }).message ?? "");
      if (msg.includes("nome do evento")) throw new ValidationError("Digite o nome do evento exatamente como aparece", { confirm: ["O nome não confere"] });
      if (msg.includes("Baixe o histórico")) throw new ConflictError("Baixe o histórico do evento antes de encerrar");
      throw new ConflictError("Só um evento concluído (e ainda não encerrado) pode ser encerrado");
    }
    if (pgErrorCode(e) === "42501") throw new NotFoundError("Encerramento");
    throw e;
  }
  // Os dados já saíram; no armazenamento externo, os arquivos saem agora.
  const storage = getStorage();
  if (!storage.inDatabase && storage.remove && keys.length) {
    await storage.remove(keys).catch((err) => console.error("Encerramento: arquivos não apagados do armazenamento", eventId, err));
  }
  return { eventId, files: keys.length };
}

// ───────────────────────────── eventos encerrados ─────────────────────────────

const archivedSelect = {
  eventId: true, closedAt: true, summary: true, closedByUser: { select: { name: true } }, agency: { select: { name: true } },
} as const;

// A agência pode não aparecer para quem só é diretor (a RLS de agências é só do Admin).
const toArchived = (a: { eventId: string; closedAt: Date | null; summary: unknown; closedByUser: { name: string } | null; agency: { name: string } | null }) => ({
  eventId: a.eventId,
  closedAt: a.closedAt!,
  closedBy: a.closedByUser?.name ?? null,
  agency: a.agency?.name ?? null,
  summary: a.summary as ClosureSummary,
});

/** Os resumos dos eventos encerrados que a pessoa vê (Admin e diretores da agência). */
export async function listArchived(actor: Actor) {
  const rows = await actor.run((tx) =>
    tx.eventArchive.findMany({ where: { closedAt: { not: null } }, orderBy: { closedAt: "desc" }, take: 200, select: archivedSelect }),
  );
  return rows.map(toArchived);
}

export async function hasArchived(actor: Actor) {
  return !!(await actor.run((tx) => tx.eventArchive.findFirst({ where: { closedAt: { not: null } }, select: { eventId: true } })));
}

export async function getArchived(actor: Actor, eventId: string) {
  if (!z.uuid().safeParse(eventId).success) throw new NotFoundError("Evento encerrado");
  const row = await actor.run((tx) => tx.eventArchive.findFirst({ where: { eventId, closedAt: { not: null } }, select: archivedSelect }));
  if (!row) throw new NotFoundError("Evento encerrado");
  return toArchived(row);
}

/** Para Meus eventos: os concluídos que esperam o histórico ou o encerramento. */
export async function pendingClosures(actor: Actor, events: { id: string; status: string }[]) {
  const ids = events.filter((e) => e.status === "CONCLUIDO" && canCloseEvent(actor, e.id)).map((e) => e.id);
  if (!ids.length) return new Map<string, { downloaded: boolean }>();
  const rows = await actor.run((tx) =>
    tx.eventArchive.findMany({ where: { eventId: { in: ids }, closedAt: null }, select: { eventId: true, historyDownloadedAt: true } }),
  );
  return new Map(rows.map((r) => [r.eventId, { downloaded: !!r.historyDownloadedAt }]));
}

export const REPORT_TITLES = REPORT_KEYS.map((k) => REPORTS[k].title);
