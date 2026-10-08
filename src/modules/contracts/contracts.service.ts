import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client";
import type { Actor } from "../../server/authz/actor";
import { canUsePreProduction } from "../../server/authz/policy";
import { audit, diff } from "../../server/audit/audit";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../server/errors";
import { isUniqueViolation } from "../../server/db/errors";
import type { Tx } from "../../server/db/with-user";
import { parseDecimal } from "../../lib/money";
import { optionalText, parse, uuid } from "../../lib/validation";
import { requireEventAccess } from "../events/events.service";
import { addDocument, deleteDocument, type DocumentUpload } from "../documents/documents.service";
import { sniffDocument } from "../documents/file";
import { itemCode, type ItemCategory } from "../items/item-meta";
import { isSupplierDirector } from "../suppliers/supplier-meta";

/**
 * Contratos (fase 3C): um por fornecedor por evento, com as propostas
 * aprovadas dele como itens. O pré-produtor monta o rascunho, anexa o PDF (que
 * fica em Documentos como CONTRATO, sem ir para o campo) e marca como enviado.
 * Só o diretor (gestor do evento) muda valor, assina ou cancela. Ao assinar, o
 * valor de cada item vira o Contratado do item do Orçamento. A RLS e os
 * gatilhos da migration *_contratos repetem as regras.
 */

function requirePre(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canUsePreProduction(actor, eventId)) throw new NotFoundError("Pré-produção");
}

function requireDirector(actor: Actor, eventId: string, what: string) {
  if (!isSupplierDirector(actor, eventId)) throw new ForbiddenError(`Só o diretor ${what}`);
}

const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));
const quoteValue = (q: { totalValue: Prisma.Decimal | null; negotiatedValue: Prisma.Decimal | null }) => num(q.negotiatedValue) ?? num(q.totalValue) ?? 0;

/** Propostas aprovadas do evento que ainda não estão num contrato ativo. */
async function freeApproved(tx: Tx, eventId: string, supplierId?: string) {
  return tx.supplierQuote.findMany({
    where: {
      eventId, status: "APROVADA", ...(supplierId && { supplierId }),
      contractItems: { none: { contract: { status: { not: "CANCELADO" } } } },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, supplierId: true, totalValue: true, negotiatedValue: true, paymentTerms: true,
      supplier: { select: { companyName: true, tradeName: true } },
      request: { select: { id: true, title: true, costItem: { select: { name: true, number: true, category: true } } } },
    },
  });
}

async function eventNumber(tx: Tx, eventId: string) {
  return (await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { number: true } })).number;
}

const itemLabel = (n: number, r: { title: string; costItem: { name: string; number: number; category: string | null } | null }) =>
  r.costItem ? { code: itemCode(n, r.costItem.category as ItemCategory | null, r.costItem.number), name: r.costItem.name } : { code: null, name: r.title };

/** Lista do evento e os fornecedores aprovados que ainda não têm contrato. */
export async function listContracts(actor: Actor, eventId: string) {
  requirePre(actor, eventId);
  return actor.run(async (tx) => {
    const [rows, free] = await Promise.all([
      tx.contract.findMany({
        where: { eventId },
        orderBy: { number: "asc" },
        select: {
          id: true, number: true, status: true, signedOn: true, documentId: true, createdAt: true,
          supplier: { select: { id: true, companyName: true, tradeName: true } },
          items: { select: { value: true } },
        },
      }),
      freeApproved(tx, eventId),
    ]);
    const pending = new Map<string, { supplierId: string; name: string; proposals: number; total: number; hasContract: boolean }>();
    for (const q of free) {
      const p = pending.get(q.supplierId) ?? {
        supplierId: q.supplierId, name: q.supplier.tradeName || q.supplier.companyName, proposals: 0, total: 0,
        hasContract: rows.some((c) => c.supplier.id === q.supplierId && c.status !== "CANCELADO"),
      };
      p.proposals += 1;
      p.total += quoteValue(q);
      pending.set(q.supplierId, p);
    }
    return {
      items: rows.map(({ items, supplier, ...c }) => ({
        ...c, supplier: supplier.tradeName || supplier.companyName, items: items.length,
        total: items.reduce((s, i) => s + Number(i.value), 0), hasFile: !!c.documentId,
      })),
      pending: [...pending.values()],
      can: { edit: true, director: isSupplierDirector(actor, eventId) },
    };
  });
}

async function load(actor: Actor, tx: Tx, id: string) {
  const c = uuid.safeParse(id).success ? await tx.contract.findUnique({ where: { id } }) : null;
  if (!c || !canUsePreProduction(actor, c.eventId)) throw new NotFoundError("Contrato");
  return c;
}

const requireDraft = (c: { status: string }) => {
  if (c.status !== "RASCUNHO") throw new ConflictError(c.status === "ENVIADO" ? "Volte o contrato para rascunho para mudar" : "Este contrato não muda mais");
};

/** Um contrato, com os itens e as propostas aprovadas do fornecedor que ainda podem entrar. */
export async function getContract(actor: Actor, id: string) {
  return actor.run(async (tx) => {
    const base = await load(actor, tx, id);
    const n = await eventNumber(tx, base.eventId);
    const [c, free, event] = await Promise.all([
      tx.contract.findUniqueOrThrow({
        where: { id: base.id },
        select: {
          id: true, eventId: true, number: true, status: true, paymentTerms: true, deliveryNotes: true, notes: true,
          sentAt: true, signedOn: true, cancelledAt: true, cancelReason: true, createdAt: true,
          supplier: { select: { id: true, companyName: true, tradeName: true, cnpj: true, contactName: true, phone: true, email: true } },
          document: { select: { id: true, fileName: true, sizeBytes: true, createdAt: true } },
          createdBy: { select: { name: true } }, signedBy: { select: { name: true } }, cancelledBy: { select: { name: true } },
          items: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true, value: true,
              quote: {
                select: {
                  id: true, totalValue: true, negotiatedValue: true, paymentTerms: true,
                  request: { select: { id: true, title: true, costItem: { select: { name: true, number: true, category: true } } } },
                },
              },
            },
          },
        },
      }),
      base.status === "RASCUNHO" ? freeApproved(tx, base.eventId, base.supplierId) : Promise.resolve([]),
      tx.event.findUniqueOrThrow({ where: { id: base.eventId }, select: { name: true } }),
    ]);
    const director = isSupplierDirector(actor, base.eventId);
    const items = c.items.map((i) => ({
      id: i.id, value: Number(i.value), proposalValue: quoteValue(i.quote), requestId: i.quote.request.id,
      requestTitle: i.quote.request.title, paymentTerms: i.quote.paymentTerms, ...itemLabel(n, i.quote.request),
    }));
    return {
      ...c,
      eventName: event.name,
      items,
      total: items.reduce((s, i) => s + i.value, 0),
      available: free.map((q) => ({ quoteId: q.id, value: quoteValue(q), requestTitle: q.request.title, ...itemLabel(n, q.request) })),
      can: {
        edit: c.status === "RASCUNHO",
        attach: c.status === "RASCUNHO" || c.status === "ENVIADO",
        send: c.status === "RASCUNHO",
        backToDraft: c.status === "ENVIADO",
        changeValue: director && c.status === "RASCUNHO",
        sign: director && (c.status === "RASCUNHO" || c.status === "ENVIADO"),
        cancel: director && c.status !== "CANCELADO",
        director,
      },
    };
  });
}

/** Novo contrato (rascunho) para um fornecedor, com as propostas aprovadas dele que ainda não têm contrato. */
export async function createContract(actor: Actor, eventId: string, input: unknown) {
  requirePre(actor, eventId);
  const { supplierId } = parse(z.object({ supplierId: uuid }), input);
  try {
    return await actor.run(async (tx) => {
      const active = await tx.contract.findFirst({ where: { eventId, supplierId, status: { not: "CANCELADO" } }, select: { number: true } });
      if (active) throw new ConflictError(`Este fornecedor já tem o contrato nº ${active.number} no evento. Inclua as propostas nele.`);
      const free = await freeApproved(tx, eventId, supplierId);
      if (!free.length) throw new ValidationError("Este fornecedor não tem proposta aprovada sem contrato no evento");
      const last = await tx.contract.findFirst({ where: { eventId }, orderBy: { number: "desc" }, select: { number: true } });
      // A condição de pagamento começa com a das propostas, quando é uma só.
      const terms = [...new Set(free.map((q) => q.paymentTerms).filter(Boolean))];
      const c = await tx.contract.create({
        data: {
          eventId, supplierId, number: (last?.number ?? 0) + 1, createdById: actor.userId,
          paymentTerms: terms.length === 1 ? terms[0] : null,
          items: { create: free.map((q) => ({ quoteId: q.id, value: quoteValue(q) })) },
        },
        select: { id: true, number: true },
      });
      await audit(tx, actor, { eventId, entity: "contract", entityId: c.id, action: "CREATE", after: { number: c.number, supplierId, quotes: free.map((q) => q.id) } });
      return c;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError("Outra pessoa acabou de criar um contrato. Atualize a tela.");
    throw e;
  }
}

const textSchema = z.object({
  paymentTerms: optionalText(500),
  deliveryNotes: optionalText(1000),
  notes: optionalText(2000),
}).partial();

/** Condição de pagamento, datas de entrega e observações (só no rascunho). */
export async function updateContract(actor: Actor, id: string, input: unknown) {
  const data = parse(textSchema, input);
  return actor.run(async (tx) => {
    const c = await load(actor, tx, id);
    requireDraft(c);
    const changes = diff(c as unknown as Record<string, unknown>, data);
    if (!Object.keys(changes.after).length) return { id: c.id };
    await tx.contract.update({ where: { id: c.id }, data });
    await audit(tx, actor, { eventId: c.eventId, entity: "contract", entityId: c.id, action: "UPDATE", ...changes });
    return { id: c.id };
  });
}

/** Inclui no rascunho uma proposta aprovada do mesmo fornecedor. */
export async function addContractItem(actor: Actor, id: string, input: unknown) {
  const { quoteId } = parse(z.object({ quoteId: uuid }), input);
  return actor.run(async (tx) => {
    const c = await load(actor, tx, id);
    requireDraft(c);
    const q = (await freeApproved(tx, c.eventId, c.supplierId)).find((x) => x.id === quoteId);
    if (!q) throw new ValidationError("Escolha uma proposta aprovada deste fornecedor que ainda não está em contrato");
    const item = await tx.contractItem.create({ data: { contractId: c.id, quoteId, value: quoteValue(q) }, select: { id: true } });
    await audit(tx, actor, { eventId: c.eventId, entity: "contract", entityId: c.id, action: "UPDATE", after: { addedQuote: quoteId, value: quoteValue(q) } });
    return item;
  });
}

async function loadItem(actor: Actor, tx: Tx, itemId: string) {
  const i = uuid.safeParse(itemId).success ? await tx.contractItem.findUnique({ where: { id: itemId } }) : null;
  if (!i) throw new NotFoundError("Item do contrato");
  return { item: i, contract: await load(actor, tx, i.contractId) };
}

export async function removeContractItem(actor: Actor, itemId: string) {
  return actor.run(async (tx) => {
    const { item, contract } = await loadItem(actor, tx, itemId);
    requireDraft(contract);
    await tx.contractItem.delete({ where: { id: item.id } });
    await audit(tx, actor, { eventId: contract.eventId, entity: "contract", entityId: contract.id, action: "UPDATE", before: { removedQuote: item.quoteId, value: Number(item.value) } });
    return { ok: true };
  });
}

const money = z.preprocess(
  (v) => (typeof v === "string" ? (parseDecimal(v) ?? v) : v),
  z.number({ message: "Informe o valor" }).min(0, "Valor inválido").max(999_999_999_999, "Valor muito alto"),
).transform((v) => Math.round(v * 100) / 100);

/** Só o diretor muda o valor de um item (no rascunho). */
export async function setContractItemValue(actor: Actor, itemId: string, input: unknown) {
  const { value } = parse(z.object({ value: money }), input);
  return actor.run(async (tx) => {
    const { item, contract } = await loadItem(actor, tx, itemId);
    requireDirector(actor, contract.eventId, "muda o valor do contrato");
    requireDraft(contract);
    await tx.contractItem.update({ where: { id: item.id }, data: { value } });
    await audit(tx, actor, {
      eventId: contract.eventId, entity: "contract", entityId: contract.id, action: "UPDATE",
      before: { item: item.id, value: Number(item.value) }, after: { item: item.id, value },
    });
    return { id: item.id, value };
  });
}

/** O PDF do contrato: entra em Documentos (CONTRATO, fora do campo) e fica ligado a ele. */
export async function attachContractPdf(actor: Actor, id: string, file: DocumentUpload | null) {
  if (!file) throw new ValidationError("Escolha o PDF do contrato");
  if (sniffDocument(file.bytes, file.name)?.mime !== "application/pdf") throw new ValidationError("Envie o contrato em PDF");
  const c = await actor.run(async (tx) => {
    const c = await load(actor, tx, id);
    if (c.status !== "RASCUNHO" && c.status !== "ENVIADO") throw new ConflictError("Este contrato não muda mais");
    const s = await tx.supplier.findUniqueOrThrow({ where: { id: c.supplierId }, select: { companyName: true, tradeName: true } });
    return { ...c, supplierName: s.tradeName || s.companyName };
  });
  const doc = await addDocument(actor, c.eventId, { category: "CONTRATO", title: `Contrato nº ${c.number} · ${c.supplierName}`, visibleToField: false }, file);
  try {
    return await actor.run(async (tx) => {
      const now = await load(actor, tx, id);
      if (now.status !== "RASCUNHO" && now.status !== "ENVIADO") throw new ConflictError("Este contrato não muda mais");
      await tx.contract.update({ where: { id: now.id }, data: { documentId: doc.id } });
      await audit(tx, actor, { eventId: now.eventId, entity: "contract", entityId: now.id, action: "UPDATE", before: { documentId: now.documentId }, after: { documentId: doc.id } });
      return { id: now.id, documentId: doc.id };
    });
  } catch (e) {
    // Não deu para ligar: o documento novo não fica solto em Documentos.
    await deleteDocument(actor, doc.id).catch(() => undefined);
    throw e;
  }
}

const statusSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ENVIAR") }),
  z.object({ action: z.literal("RASCUNHO") }),
  z.object({ action: z.literal("ASSINAR"), signedOn: z.iso.date({ message: "Informe a data da assinatura" }) }),
  z.object({ action: z.literal("CANCELAR"), reason: z.string().trim().min(1, "Explique o cancelamento").max(500) }),
]);

/**
 * Andamento: enviar ao fornecedor e voltar para rascunho (Pré-produção);
 * assinar e cancelar (só o diretor). Assinar leva o valor de cada item para o
 * Contratado do item do Orçamento.
 */
export async function setContractStatus(actor: Actor, id: string, input: unknown) {
  const data = parse(statusSchema, input);
  return actor.run(async (tx) => {
    const c = await load(actor, tx, id);
    const now = new Date();
    let patch: Prisma.ContractUpdateInput;
    if (data.action === "ENVIAR") {
      if (c.status !== "RASCUNHO") throw new ConflictError("O contrato já saiu do rascunho");
      if (!(await tx.contractItem.count({ where: { contractId: c.id } }))) throw new ValidationError("Inclua pelo menos uma proposta antes de enviar");
      patch = { status: "ENVIADO", sentAt: now };
    } else if (data.action === "RASCUNHO") {
      if (c.status !== "ENVIADO") throw new ConflictError("Só um contrato enviado volta para rascunho");
      patch = { status: "RASCUNHO" };
    } else if (data.action === "ASSINAR") {
      requireDirector(actor, c.eventId, "assina o contrato");
      if (c.status !== "RASCUNHO" && c.status !== "ENVIADO") throw new ConflictError("Este contrato não pode ser assinado");
      if (!c.documentId) throw new ValidationError("Anexe o PDF do contrato antes de assinar");
      if (!(await tx.contractItem.count({ where: { contractId: c.id } }))) throw new ValidationError("Inclua pelo menos uma proposta antes de assinar");
      patch = { status: "ASSINADO", signedOn: new Date(`${data.signedOn}T00:00:00Z`), signedBy: { connect: { id: actor.userId } }, sentAt: c.sentAt ?? now };
    } else {
      requireDirector(actor, c.eventId, "cancela o contrato");
      if (c.status === "CANCELADO") throw new ConflictError("O contrato já está cancelado");
      patch = { status: "CANCELADO", cancelledAt: now, cancelReason: data.reason, cancelledBy: { connect: { id: actor.userId } } };
    }
    const updated = await tx.contract.update({ where: { id: c.id }, data: patch, select: { id: true, status: true } });
    await audit(tx, actor, {
      eventId: c.eventId, entity: "contract", entityId: c.id, action: data.action === "CANCELAR" ? "CANCEL" : "STATUS_CHANGE",
      before: { status: c.status }, after: { status: updated.status, ...(data.action === "ASSINAR" && { signedOn: data.signedOn }), ...(data.action === "CANCELAR" && { reason: data.reason }) },
    });
    if (data.action === "ASSINAR") await applyToBudget(tx, actor, c.id, c.eventId);
    return updated;
  });
}

/** Assinado: o valor dos itens (somado por item do Orçamento) vira o Contratado. */
async function applyToBudget(tx: Tx, actor: Actor, contractId: string, eventId: string) {
  const items = await tx.contractItem.findMany({
    where: { contractId },
    select: { value: true, quote: { select: { request: { select: { costItemId: true } } } } },
  });
  const byItem = new Map<string, number>();
  for (const i of items) {
    const id = i.quote.request.costItemId;
    if (id) byItem.set(id, Math.round(((byItem.get(id) ?? 0) + Number(i.value)) * 100) / 100);
  }
  for (const [costItemId, value] of byItem) {
    const before = await tx.costItem.findFirst({ where: { id: costItemId, eventId }, select: { contractedValue: true } });
    if (!before) continue;
    await tx.costItem.update({ where: { id: costItemId }, data: { contractedValue: value } });
    await audit(tx, actor, {
      eventId, entity: "cost_item", entityId: costItemId, action: "UPDATE",
      before: { contractedValue: num(before.contractedValue) }, after: { contractedValue: value, fromContract: contractId },
    });
  }
}
