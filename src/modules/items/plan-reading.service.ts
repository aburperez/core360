import { z } from "zod";
import type { Actor } from "../../server/authz/actor";
import { canUseSection, isExecutive, productionArea } from "../../server/authz/policy";
import { audit } from "../../server/audit/audit";
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../server/errors";
import type { Tx } from "../../server/db/with-user";
import { optionalText, parse, text, uuid } from "../../lib/validation";
import { parseDecimal } from "../../lib/money";
import { requireEventAccess } from "../events/events.service";
import { normName } from "../areas/areas.service";
import { sniffImage } from "../attachments/image";
import { addDocument } from "../documents/documents.service";
import { maxDocumentBytes } from "../documents/file";
import { formatBytes } from "../../lib/documents";
import { assertFinancialOpen } from "../finance/lock";
import { suggestArea } from "./items.service";
import { assertProductionArea } from "./production-area";
import {
  anthropicPlanReader, PLAN_CATEGORIES, PLAN_READABLE, PLAN_READER_MODEL, planReaderEnabled,
  type PlanMime, type PlanReader,
} from "./plan-reader";
import { AiUnavailableError } from "../quotes/quote-reader";

/**
 * Leitor de planta da área Técnica (2026-10-21). A IA lê a planta técnica e
 * devolve a lista de itens; NADA é salvo na leitura. Quem enviou confere,
 * corrige e toca em "Adicionar aos itens" (addPlanItems), que cria os itens na
 * planilha, na área escolhida, como "A definir", prontos para a cotação.
 * Quem usa: quem tem o Mapa de itens na pré-produção (o Pré-produtor de uma
 * área só na área dele; a RLS de cost_items repete a regra).
 */

/** Leituras pela IA por pessoa, por hora (cada uma custa). */
export const MAX_PLAN_READS_PER_HOUR = 10;
/** Linhas que entram de uma vez. */
export const MAX_PLAN_ITEMS = 150;
/** Seção nova padrão para os itens da planta. */
export const PLAN_SECTION = "Técnica";

export interface PlanFile {
  bytes: Uint8Array;
  name: string;
}

function requireItems(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canUseSection(actor, eventId, "ITENS")) throw new NotFoundError("Pré-produção");
  if (isExecutive(actor, eventId)) {
    throw new ForbiddenError("O Produtor executivo cuida de estrutura e cenografia. Peça a planta técnica ao produtor da área Técnica.");
  }
}

/** PDF ou foto (JPG, PNG, WebP), conferido pelos bytes. */
export function sniffPlanFile(bytes: Uint8Array): { mime: PlanMime; ext: string } | null {
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-") return { mime: "application/pdf", ext: "pdf" };
  const image = sniffImage(bytes);
  return image && (PLAN_READABLE as readonly string[]).includes(image.mime) ? { mime: image.mime as PlanMime, ext: image.ext } : null;
}

function checkFile(file: PlanFile | null) {
  if (!file || file.bytes.length === 0) throw new ValidationError("Anexe a planta em PDF ou foto");
  const max = maxDocumentBytes();
  if (file.bytes.length > max) throw new ValidationError(`Arquivo maior que ${formatBytes(max)}`);
  const kind = sniffPlanFile(file.bytes);
  if (!kind) {
    throw new ValidationError(/\.dwg$/i.test(file.name)
      ? "A IA não abre DWG (AutoCAD). Exporte a planta em PDF e envie de novo."
      : "Envie a planta em PDF ou foto (JPG, PNG). DWG: exporte em PDF antes.");
  }
  const name = file.name.replace(/[\\/\r\n"]/g, "_").trim().slice(0, 160) || `planta.${kind.ext}`;
  return { ...kind, name };
}

/** Áreas do evento e a sugerida para a planta: a da pessoa ou a Técnica. */
async function areasFor(actor: Actor, tx: Tx, eventId: string) {
  const areas = await tx.area.findMany({ where: { eventId, deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const mine = productionArea(actor, eventId);
  return { areas, mine, suggested: mine ?? suggestArea("TECNICA", areas) };
}

/** O que a tela do leitor precisa: áreas, seções, a área sugerida e se a IA está ligada. */
export async function planReaderOptions(actor: Actor, eventId: string) {
  requireItems(actor, eventId);
  return actor.run(async (tx) => {
    const { areas, mine, suggested } = await areasFor(actor, tx, eventId);
    const sections = await tx.costSection.findMany({ where: { eventId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true, name: true } });
    const technical = sections.find((s) => normName(s.name).startsWith("tecnica")) ?? null;
    return {
      areas: mine ? areas.filter((a) => a.id === mine) : areas,
      areaLocked: !!mine,
      suggestedAreaId: suggested,
      sections,
      suggestedSectionId: technical?.id ?? null,
      canSaveDocument: canUseSection(actor, eventId, "DOCUMENTOS"),
      enabled: planReaderEnabled(),
      maxBytes: maxDocumentBytes(),
    };
  });
}

const clip = (v: string | null | undefined, max: number) => (v ? v.replace(/\s+/g, " ").trim().slice(0, max) || null : null);
const clipLines = (v: string | null, max: number) => (v ? v.trim().slice(0, max) || null : null);

/**
 * A IA lê a planta e devolve a lista de itens técnicos, arrumada. Itens com o
 * mesmo nome de um que já está na área vêm marcados ("já na planilha"). Só
 * fica o registro da leitura no histórico (quem, quando, arquivo, custo).
 */
export async function readTechnicalPlan(actor: Actor, eventId: string, file: PlanFile | null, input: unknown = {}, reader: PlanReader = anthropicPlanReader) {
  requireItems(actor, eventId);
  const kind = checkFile(file);
  const { areaId } = parse(z.object({ areaId: uuid.nullable().optional() }), input);
  const ctx = await actor.run(async (tx) => {
    const reads = await tx.auditLog.count({
      where: { actorUserId: actor.userId, entity: "plan_reading", occurredAt: { gte: new Date(Date.now() - 3_600_000) } },
    });
    if (reads >= MAX_PLAN_READS_PER_HOUR) throw new AppError("Limite de leituras de planta nesta hora. Tente mais tarde.", 429, "AI_LIMIT");
    const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { name: true } });
    const { areas, suggested } = await areasFor(actor, tx, eventId);
    const target = areaId === undefined ? suggested : areaId;
    const area = target ? (areas.find((a) => a.id === target) ?? null) : null;
    const existing = await tx.costItem.findMany({
      where: { eventId, ...(area ? { areaId: area.id } : {}) }, select: { name: true },
    });
    return { event, area, existing: new Set(existing.map((i) => normName(i.name))) };
  });
  if (reader === anthropicPlanReader && !planReaderEnabled()) throw new AiUnavailableError("A leitura pela IA não está ligada. Lance os itens à mão.");

  const read = await reader({ bytes: file!.bytes, mime: kind.mime }, { eventName: ctx.event.name, areaName: ctx.area?.name ?? null });

  const items = read.items
    .map((i) => ({
      name: clip(i.name, 200),
      category: (PLAN_CATEGORIES as readonly string[]).includes(i.category) ? i.category : "TECNICA",
      quantity: i.quantity !== null && i.quantity > 0 && i.quantity < 1e8 ? Math.round(i.quantity * 1000) / 1000 : null,
      unit: clip(i.unit, 20),
      location: clip(i.location, 200),
      description: clip(i.description, 500),
    }))
    .filter((i): i is typeof i & { name: string } => !!i.name)
    .slice(0, MAX_PLAN_ITEMS)
    .map((i) => ({ ...i, existing: ctx.existing.has(normName(i.name)) }));

  const warnings: string[] = [];
  if (!read.isPlan) warnings.push("O arquivo não parece uma planta técnica. Confira cada item com cuidado.");
  if (!items.length) warnings.push("A IA não encontrou itens técnicos nesta planta.");
  if (read.items.length > MAX_PLAN_ITEMS) warnings.push(`A planta tem mais de ${MAX_PLAN_ITEMS} linhas: vieram só as ${MAX_PLAN_ITEMS} primeiras.`);
  const noQty = items.filter((i) => i.quantity === null).length;
  if (noQty) warnings.push(`${noQty} ${noQty === 1 ? "item ficou" : "itens ficaram"} sem quantidade: confira na planta.`);
  const dup = items.filter((i) => i.existing).length;
  if (dup) warnings.push(`${dup} ${dup === 1 ? "item já está" : "itens já estão"} na planilha com o mesmo nome e ${dup === 1 ? "veio desmarcado" : "vieram desmarcados"}.`);

  await actor.run((tx) => audit(tx, actor, {
    eventId, entity: "plan_reading", entityId: eventId, action: "CREATE",
    after: {
      fileName: kind.name, mime: kind.mime, size: file!.bytes.length, model: PLAN_READER_MODEL, areaId: ctx.area?.id ?? null,
      items: items.length, inputTokens: read.usage.input, outputTokens: read.usage.output, isPlan: read.isPlan,
    },
  }));

  return {
    summary: clipLines(read.summary, 500),
    notes: clipLines(read.notes, 2000),
    items,
    areaId: ctx.area?.id ?? null,
    warnings,
  };
}

const amount = z.preprocess(
  (v) => (typeof v === "string" ? (parseDecimal(v) ?? v) : v),
  z.number({ message: "Quantidade inválida" }).positive("A quantidade precisa ser maior que zero").max(1e8, "Quantidade alta demais"),
).transform((n) => Math.round(n * 1000) / 1000);

const addSchema = z.object({
  areaId: uuid.nullable(),
  /** Seção da planilha que já existe, ou o nome de uma nova. */
  sectionId: uuid.nullable().optional(),
  newSection: optionalText(120),
  saveDocument: z.boolean().default(false),
  items: z.array(z.object({
    name: text(200),
    category: z.enum(PLAN_CATEGORIES),
    quantity: amount,
    unit: optionalText(20),
    location: optionalText(200),
    description: optionalText(5000),
  })).min(1, "Marque pelo menos um item").max(MAX_PLAN_ITEMS, `No máximo ${MAX_PLAN_ITEMS} itens de uma vez`),
});

/**
 * Os itens conferidos entram na planilha: na seção escolhida (ou numa nova),
 * na área escolhida, como "A definir". Tudo numa transação: ou entram todos,
 * ou nenhum. A planta, se pedida, vai para os Documentos (categoria Planta).
 */
export async function addPlanItems(actor: Actor, eventId: string, input: unknown, file: PlanFile | null = null) {
  requireItems(actor, eventId);
  const data = parse(addSchema, input);
  if (!data.sectionId && !data.newSection) throw new ValidationError("Escolha a seção da planilha", { sectionId: ["Escolha a seção"] });
  const mine = productionArea(actor, eventId);
  const areaId = mine && data.areaId === null ? mine : data.areaId;
  assertProductionArea(actor, eventId, areaId);
  if (data.saveDocument) {
    if (!canUseSection(actor, eventId, "DOCUMENTOS")) throw new ForbiddenError("Você não tem acesso aos Documentos do evento");
    checkFile(file);
  }

  const created = await actor.run(async (tx) => {
    await assertFinancialOpen(tx, eventId);
    if (areaId) {
      const a = await tx.area.findFirst({ where: { id: areaId, eventId, deletedAt: null }, select: { id: true } });
      if (!a) throw new ValidationError("Área não encontrada neste evento", { areaId: ["Escolha uma área do evento"] });
    }
    let section: { id: string; name: string };
    if (data.sectionId) {
      const s = await tx.costSection.findFirst({ where: { id: data.sectionId, eventId }, select: { id: true, name: true } });
      if (!s) throw new NotFoundError("Seção");
      section = s;
    } else {
      const last = await tx.costSection.aggregate({ where: { eventId }, _max: { position: true } });
      section = await tx.costSection.create({ data: { eventId, name: data.newSection!, position: (last._max.position ?? 0) + 1 }, select: { id: true, name: true } });
      await audit(tx, actor, { eventId, entity: "cost_section", entityId: section.id, action: "CREATE", after: { name: section.name } });
    }
    const last = await tx.costItem.aggregate({ where: { eventId, sectionId: section.id }, _max: { position: true } });
    let position = last._max.position ?? 0;
    const ids: string[] = [];
    for (const i of data.items) {
      const item = await tx.costItem.create({
        data: {
          eventId, sectionId: section.id, position: ++position, areaId,
          name: i.name, category: i.category, quantity: i.quantity, unit: i.unit, location: i.location, description: i.description,
        },
        select: { id: true },
      });
      ids.push(item.id);
      await audit(tx, actor, {
        eventId, entity: "cost_item", entityId: item.id, action: "CREATE",
        after: { ...i, areaId, sectionId: section.id, source: "planta" },
      });
    }
    return { section, ids };
  });

  // Fora da transação dos itens: a planta repetida nos Documentos não desfaz os itens.
  let document: "saved" | "duplicate" | "failed" | null = null;
  if (data.saveDocument && file) {
    const name = file.name.replace(/\.[^.]+$/, "").trim();
    try {
      await addDocument(actor, eventId, { category: "PLANTA", title: `Planta técnica${name ? ` · ${name}` : ""}` }, file);
      document = "saved";
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      document = e instanceof ConflictError ? "duplicate" : "failed";
    }
  }
  return { added: created.ids.length, sectionId: created.section.id, sectionName: created.section.name, document };
}
