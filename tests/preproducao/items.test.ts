import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectPgError, expectStatus, ownerDb, type Person } from "../helpers";
import { withUser, type Tx } from "@/server/db/with-user";
import { memoryStorage, setStorageForTests } from "@/server/storage/storage";
import { createCostItem, createCostSection, getCostSheet, updateCostItem } from "@/modules/costs/costs.service";
import { addSupplierQuote, chooseQuote, createQuote, markQuoteSent } from "@/modules/quotes/quotes.service";
import { checkReceipt, listReceipts, sendToField, setItemReceiver } from "@/modules/receipts/receipts.service";
import { getItem, listItemMap } from "@/modules/items/items.service";
import { canSetItemStatus, effectiveCostCenter, itemCode } from "@/modules/items/item-meta";
import { createEvent } from "@/modules/events/events.service";
import { updateParticipant } from "@/modules/participants/participants.service";

/**
 * Item do evento (fase 2A do roadmap): código, área, categoria, centro de
 * custo, responsável, data, local e os 13 status. A Pré-produtora (Sofia)
 * cuida do dia a dia; centro de custo, Aprovado, Contratado, os status do
 * campo e Finalizado são do diretor (Marina, Gerente). Os status mudam
 * sozinhos com a cotação e com a conferência no campo. O mesmo vale no banco.
 */

const db = appDb();
const owner = ownerDb();
const d = demo();
const rock = d.events.rock.id;
const P = d.participants;
const as = <T>(p: Person, fn: (tx: Tx) => Promise<T>) => withUser(db, d.users[p]!, fn);
const created = { sections: [] as string[], events: [] as string[] };

beforeAll(() => setStorageForTests(memoryStorage()));
afterAll(async () => {
  const items = await owner.costItem.findMany({ where: { sectionId: { in: created.sections } }, select: { id: true } });
  const ids = items.map((i) => i.id);
  const reqs = await owner.quoteRequest.findMany({ where: { costItemId: { in: ids } }, select: { id: true } });
  await owner.quoteRequest.updateMany({
    where: { id: { in: reqs.map((r) => r.id) } },
    data: { status: "CANCELADA", chosenQuoteId: null, chosenReason: null, closedAt: null, closedById: null },
  });
  await owner.supplierQuote.deleteMany({ where: { requestId: { in: reqs.map((r) => r.id) } } });
  await owner.quoteRequest.deleteMany({ where: { id: { in: reqs.map((r) => r.id) } } });
  await owner.itemReceipt.deleteMany({ where: { costItemId: { in: ids } } });
  await owner.costSection.deleteMany({ where: { id: { in: created.sections } } });
  await Promise.all([db.$disconnect(), owner.$disconnect()]);
});

async function section(name: string) {
  const s = await createCostSection(await actorFor(db, "marina"), rock, { name });
  created.sections.push(s.id);
  return s;
}

const supplier = (n: number, value: number) => ({
  cnpj: ["11.222.333/0001-81", "45.723.174/0001-10", "04.252.011/0001-10"][n - 1],
  companyName: `Fornecedor ${n} Ltda`, phone: "(11) 98765-432" + n, email: `contato${n}@fornecedor.dev`,
  contactName: `Pessoa ${n}`, totalValue: value,
});

const statusOf = async (id: string) => (await owner.costItem.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

describe("código e categoria", () => {
  it("código EVT + número do evento na agência, sigla da categoria e número do item", () => {
    expect(itemCode(1, "CENOGRAFIA", 23)).toBe("EVT001-CEN-023");
    expect(itemCode(12, null, 4)).toBe("EVT012-GER-004");
    expect(effectiveCostCenter("COMUNICACAO_VISUAL", null)).toBe("CENO");
    expect(effectiveCostCenter("COMUNICACAO_VISUAL", "STAFF")).toBe("STAFF");
    expect(effectiveCostCenter(null, null)).toBeNull();
  });

  it("evento novo ganha o próximo número da agência; item novo, o próximo do evento", async () => {
    const admin = await actorFor(db, "admin");
    const rockRow = await owner.event.findUniqueOrThrow({ where: { id: rock }, select: { number: true, agencyId: true } });
    const max = await owner.event.aggregate({ where: { agencyId: rockRow.agencyId }, _max: { number: true } });
    const ev = await createEvent(admin, { clientId: d.clients.rock.id, name: "Show dos itens", startsAt: "2027-10-01T10:00", endsAt: "2027-10-01T22:00" });
    const row = await owner.event.findUniqueOrThrow({ where: { id: ev.id }, select: { number: true, itemSeq: true } });
    expect(row).toEqual({ number: (max._max.number ?? 0) + 1, itemSeq: 0 });

    const s = await section("Cenografia / Ativações");
    const a = await createCostItem(await actorFor(db, "sofia"), s.id, { name: "Painel LED 4x2m", unitValue: 12000, quantity: 1 });
    const b = await createCostItem(await actorFor(db, "sofia"), s.id, { name: "Totem", unitValue: 800, quantity: 2 });
    expect(b.number).toBe(a.number + 1);
    // Categoria deduzida pela seção; o código aparece na planilha.
    const sheet = await getCostSheet(await actorFor(db, "marina"), rock);
    const row2 = sheet.sections.flatMap((x) => x.items).find((i) => i.id === a.id)!;
    expect(row2.category).toBe("CENOGRAFIA");
    expect(row2.code).toBe(itemCode(rockRow.number, "CENOGRAFIA", a.number));
    expect(row2.status).toBe("A_DEFINIR");
    // O número não muda, nem direto no banco.
    await as("marina", (tx) => tx.costItem.update({ where: { id: a.id }, data: { number: 999 } }));
    expect((await owner.costItem.findUniqueOrThrow({ where: { id: a.id } })).number).toBe(a.number);
    await as("admin", (tx) => tx.event.update({ where: { id: rock }, data: { number: 999 } }));
    expect((await owner.event.findUniqueOrThrow({ where: { id: rock } })).number).toBe(rockRow.number);
  });
});

describe("quem muda o quê", () => {
  it("a Pré-produção preenche área, responsável, data, local, unidade e os status dela", async () => {
    const sofia = await actorFor(db, "sofia");
    const s = await section("Comunicação visual");
    const item = await createCostItem(sofia, s.id, { name: "Backdrop", unitValue: 3000, quantity: 1 });
    await updateCostItem(sofia, item.id, {
      areaId: d.areas.infra.id, responsibleId: P.ana.id, neededOn: "2027-06-10", location: "Palco",
      unit: "m²", quantity: "40", notes: "Necessário backup", status: "EM_PRODUCAO",
    });
    const { item: got } = await getItem(sofia, item.id);
    expect(got).toMatchObject({
      areaName: "Infraestrutura", responsibleName: P.ana.name, neededOn: "2027-06-10", location: "Palco", unit: "m²",
      quantity: 40, notes: "Necessário backup", status: "EM_PRODUCAO", category: "COMUNICACAO_VISUAL", costCenter: "CENO",
    });
    // Mudar só o status não apaga o resto.
    await updateCostItem(sofia, item.id, { status: "PRONTO" });
    expect((await getItem(sofia, item.id)).item).toMatchObject({ location: "Palco", unit: "m²", status: "PRONTO" });
  });

  it("área e responsável precisam ser deste evento", async () => {
    const sofia = await actorFor(db, "sofia");
    const s = await section("Logística");
    const item = await createCostItem(sofia, s.id, { name: "Frete", unitValue: 900, quantity: 1 });
    await expectStatus(updateCostItem(sofia, item.id, { areaId: d.areas.congressoInfra.id }), 422);
    await expectStatus(updateCostItem(sofia, item.id, { responsibleId: P.joaoCongresso.id }), 422);
    // No banco, a chave composta barra a área de outro evento.
    await expectPgError(as("sofia", (tx) => tx.costItem.update({ where: { id: item.id }, data: { areaId: d.areas.congressoInfra.id } })), "23503");
  });

  it("centro de custo, Aprovado, Contratado, campo e Finalizado: só o diretor, também no banco", async () => {
    const sofia = await actorFor(db, "sofia");
    const marina = await actorFor(db, "marina");
    const s = await section("Técnica");
    const item = await createCostItem(sofia, s.id, { name: "Som", unitValue: 5000, quantity: 1 });
    await expectStatus(updateCostItem(sofia, item.id, { costCenter: "STAFF" }), 403);
    for (const st of ["APROVADO", "CONTRATADO", "NO_LOCAL", "FINALIZADO"]) {
      await expectStatus(updateCostItem(sofia, item.id, { status: st }), 403);
    }
    await expectPgError(as("sofia", (tx) => tx.costItem.update({ where: { id: item.id }, data: { costCenter: "STAFF" } })), "42501");
    await expectPgError(as("sofia", (tx) => tx.costItem.update({ where: { id: item.id }, data: { status: "APROVADO" } })), "42501");
    expect((await getItem(sofia, item.id)).can).toMatchObject({ director: false, costCenter: false });

    await updateCostItem(marina, item.id, { costCenter: "PRODUCAO", status: "APROVADO" });
    expect((await getItem(marina, item.id)).item).toMatchObject({ costCenter: "PRODUCAO", costCenterChosen: "PRODUCAO", status: "APROVADO" });
    // Aprovado não volta para antes da aprovação pela Pré-produção, mas segue em frente.
    await expectStatus(updateCostItem(sofia, item.id, { status: "A_DEFINIR" }), 403);
    await expectPgError(as("sofia", (tx) => tx.costItem.update({ where: { id: item.id }, data: { status: "EM_COTACAO" } })), "42501");
    await updateCostItem(sofia, item.id, { status: "EM_PRODUCAO" });
    // Finalizado: só o diretor tira.
    await updateCostItem(marina, item.id, { status: "FINALIZADO" });
    await expectStatus(updateCostItem(sofia, item.id, { status: "PRONTO" }), 403);
    // Voltar o centro de custo para o da categoria.
    await updateCostItem(marina, item.id, { costCenter: null });
    expect((await getItem(marina, item.id)).item).toMatchObject({ costCenter: "TECNICA", costCenterChosen: null });
  });

  it("regra de status igual na tela e no banco", () => {
    expect(canSetItemStatus("A_DEFINIR", "EM_TRANSPORTE", false)).toBe(true);
    expect(canSetItemStatus("CONTRATADO", "EM_PRODUCAO", false)).toBe(true);
    expect(canSetItemStatus("CONTRATADO", "EM_APROVACAO", false)).toBe(false);
    expect(canSetItemStatus("NO_LOCAL", "EM_TRANSPORTE", false)).toBe(false);
    expect(canSetItemStatus("NO_LOCAL", "A_DEFINIR", true)).toBe(true);
  });
});

describe("status que mudam sozinhos", () => {
  it("cotação: enviada, 1º orçamento, 3 orçamentos e vencedor", async () => {
    const sofia = await actorFor(db, "sofia");
    const marina = await actorFor(db, "marina");
    const s = await section("Mobiliário");
    const item = await createCostItem(sofia, s.id, { name: "Lounge", unitValue: null, quantity: 1 });
    const { id } = await createQuote(sofia, rock, { title: "Lounge", briefing: "Sofás e pufes", responsibleId: P.sofia.id, costItemId: item.id });
    expect(await statusOf(item.id)).toBe("A_DEFINIR");
    await markQuoteSent(sofia, id);
    expect(await statusOf(item.id)).toBe("EM_COTACAO");
    const q1 = await addSupplierQuote(sofia, id, supplier(1, 3000));
    expect(await statusOf(item.id)).toBe("COTACAO_RECEBIDA");
    await addSupplierQuote(sofia, id, supplier(2, 2800));
    await addSupplierQuote(sofia, id, supplier(3, 3100));
    expect(await statusOf(item.id)).toBe("EM_APROVACAO");
    await chooseQuote(marina, id, { quoteId: q1.id, reason: "Entrega antes" });
    expect(await statusOf(item.id)).toBe("APROVADO");
    // O fornecedor sai do orçamento escolhido.
    expect((await getItem(sofia, item.id)).item.supplier).toBe("Fornecedor 1 Ltda");
  });

  it("nunca volta: um item já em produção não regride com uma cotação nova", async () => {
    const sofia = await actorFor(db, "sofia");
    const s = await section("Brindes");
    const item = await createCostItem(sofia, s.id, { name: "Copos", unitValue: 2, quantity: 500 });
    await updateCostItem(sofia, item.id, { status: "EM_PRODUCAO" });
    const { id } = await createQuote(sofia, rock, { title: "Copos", briefing: "500 copos", responsibleId: P.sofia.id, costItemId: item.id });
    await markQuoteSent(sofia, id);
    await addSupplierQuote(sofia, id, supplier(1, 1000));
    expect(await statusOf(item.id)).toBe("EM_PRODUCAO");
  });

  it("conferido no campo → No local; o campo vê unidade e local, sem valores", async () => {
    const marina = await actorFor(db, "marina");
    const s = await section("Energia");
    const item = await createCostItem(marina, s.id, { name: "Gerador 500 kVA", unitValue: 7000, quantity: 1 });
    await updateCostItem(marina, item.id, { unit: "UN", location: "Backstage" });
    await setItemReceiver(marina, item.id, { participantId: P.pedro.id });
    await sendToField(marina, rock);
    const pedro = await actorFor(db, "pedro");
    const mine = (await listReceipts(pedro, rock)).rows.find((r) => r.costItemId === item.id)!;
    expect(mine).toMatchObject({ unit: "UN", location: "Backstage" });
    expect(JSON.stringify(mine)).not.toMatch(/7000|unitValue/);
    await checkReceipt(pedro, mine.id, { status: "OK" });
    expect(await statusOf(item.id)).toBe("NO_LOCAL");
    // O campo não mexe no item direto.
    expect(await as("pedro", (tx) => tx.costItem.updateMany({ where: { id: item.id }, data: { status: "CONFERIDO" } }))).toEqual({ count: 0 });
    await setItemReceiver(marina, item.id, { participantId: null });
    await sendToField(marina, rock);
  });
});

describe("Mapa de itens", () => {
  it("sem valores, com filtros por área, status, responsável e categoria", async () => {
    const sofia = await actorFor(db, "sofia");
    const s = await section("Segurança");
    const a = await createCostItem(sofia, s.id, { name: "Vigilante", unitValue: 400, quantity: 10 });
    const b = await createCostItem(sofia, s.id, { name: "Brigadista", unitValue: 450, quantity: 4 });
    await updateCostItem(sofia, a.id, { areaId: d.areas.ab.id, responsibleId: P.beatriz.id, status: "PRONTO" });

    const all = await listItemMap(sofia, rock);
    expect(all.items.map((i) => i.id)).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(JSON.stringify(all.items)).not.toMatch(/unitValue|subtotal/);
    expect(all.byStatus.PRONTO).toBeGreaterThan(0);

    const byArea = await listItemMap(sofia, rock, { area: d.areas.ab.id });
    expect(byArea.items.every((i) => i.areaId === d.areas.ab.id)).toBe(true);
    expect(byArea.items.map((i) => i.id)).toContain(a.id);
    const byPerson = await listItemMap(sofia, rock, { responsible: P.beatriz.id, status: "PRONTO" });
    expect(byPerson.items.map((i) => i.id)).toEqual([a.id]);
    const noOwner = await listItemMap(sofia, rock, { responsible: "none", category: "SEGURANCA" });
    expect(noOwner.items.map((i) => i.id)).toEqual([b.id]);
    // Filtro que não existe é ignorado.
    expect((await listItemMap(sofia, rock, { status: "QUALQUER" })).items.length).toBe(all.items.length);
  });

  it("o campo, o Cliente e outro evento não abrem", async () => {
    for (const p of ["joao", "rafael", "claudia", "paulo"] as const) {
      await expectStatus(listItemMap(await actorFor(db, p), rock), 404);
    }
    const s = await section("Limpeza");
    const item = await createCostItem(await actorFor(db, "sofia"), s.id, { name: "Equipe de limpeza", unitValue: 100, quantity: 6 });
    await expectStatus(getItem(await actorFor(db, "joao"), item.id), 404);
    await expectStatus(getItem(await actorFor(db, "paulo"), item.id), 404);
    await expectStatus(updateCostItem(await actorFor(db, "rafael"), item.id, { status: "PRONTO" }), 404);
  });
});

describe("equipe: empresa e responsável direto", () => {
  it("Montar equipe grava os dois, e desativar não apaga telefone nem função", async () => {
    const marina = await actorFor(db, "marina");
    const before = await owner.participant.findUniqueOrThrow({ where: { id: P.lucas.id } });
    await updateParticipant(marina, P.lucas.id, { company: "Montadora XYZ", directManager: "Rafael" });
    await updateParticipant(marina, P.lucas.id, { active: false });
    await updateParticipant(marina, P.lucas.id, { active: true });
    const after = await owner.participant.findUniqueOrThrow({ where: { id: P.lucas.id } });
    expect(after).toMatchObject({ company: "Montadora XYZ", directManager: "Rafael", phone: before.phone, jobTitle: before.jobTitle, active: true });
    await updateParticipant(marina, P.lucas.id, { company: null, directManager: null });
  });
});
