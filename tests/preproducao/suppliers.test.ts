import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, authDb, demo, expectPgError, expectStatus, ownerDb, type Person } from "../helpers";
import { loadActor } from "@/server/authz/actor";
import { withUser, type Tx } from "@/server/db/with-user";
import { acceptInvitation } from "@/server/auth/invitations";
import { createAgency } from "@/modules/agencies/agencies.service";
import { createClient } from "@/modules/clients/clients.service";
import { createEvent } from "@/modules/events/events.service";
import { createCostItem, createCostSection } from "@/modules/costs/costs.service";
import { addSupplierQuote, chooseQuote, createQuote, getQuote, markQuoteSent } from "@/modules/quotes/quotes.service";
import {
  createSupplier,
  getSupplier,
  listContractedSuppliers,
  listSuppliers,
  setSupplierArchived,
  setSupplierBonus,
  updateSupplier,
} from "@/modules/suppliers/suppliers.service";
import { bonusText } from "@/modules/suppliers/supplier-meta";

/**
 * Cadastro de fornecedores (fase 3A): um por CNPJ em cada agência. A
 * Pré-produção cadastra e edita; só o diretor arquiva e mexe na bonificação,
 * que o Pré-produtor não vê. O Head vê os fornecedores contratados para a área
 * dele, com a bonificação. Uma agência não vê o cadastro da outra. Pelo
 * serviço e direto no banco.
 */

const db = appDb();
const owner = ownerDb();
const auth$ = authDb();
const d = demo();
afterAll(async () => {
  // O evento de teste sai de cena, para não mudar o que os outros testes contam.
  await owner.event.update({ where: { id: ev }, data: { deletedAt: new Date() } });
  await Promise.all([db.$disconnect(), owner.$disconnect(), auth$.$disconnect()]);
});

const uniq = () => Math.random().toString(36).slice(2, 8);
const asUser = <T>(userId: string, fn: (tx: Tx) => Promise<T>) => withUser(db, userId, fn);
const as = <T>(p: Person, fn: (tx: Tx) => Promise<T>) => asUser(d.users[p]!, fn);

// CNPJs válidos (dígitos conferidos).
const CNPJ = { gerador: "32.045.187/0001-36", led: "57.890.234/0001-79", som: "66.123.458/0001-46" };
const digits = (c: string) => c.replace(/\D/g, "");

// Evento próprio na agência da demonstração, com duas áreas e um Head em cada.
let ev: string;
let infra: string;
let ab: string;
let beta: { adminUserId: string; eventId: string };

beforeAll(async () => {
  const e = await createEvent(await actorFor(db, "admin"), { clientId: d.clients.rock.id, name: "Feira dos fornecedores", startsAt: "2027-12-01T10:00", endsAt: "2027-12-02T22:00" });
  ev = e.id;
  infra = (await owner.area.create({ data: { eventId: ev, name: "Infraestrutura" } })).id;
  ab = (await owner.area.create({ data: { eventId: ev, name: "A&B" } })).id;
  const team = (await owner.team.create({ data: { eventId: ev, areaId: infra, name: "Elétrica" } })).id;
  const join = (p: Person, role: "GERENTE" | "PRE_PRODUTOR" | "HEAD" | "OPERACIONAL" | "CLIENTE", areaId?: string) =>
    owner.participant.create({
      data: {
        eventId: ev, userId: d.users[p]!, name: p, email: `${p}-forn@rockfestival.dev`, role, areaId,
        teamId: role === "OPERACIONAL" ? team : undefined, joinedAt: new Date(),
      },
    });
  await join("marina", "GERENTE");
  await join("sofia", "PRE_PRODUTOR");
  await join("rafael", "HEAD", infra);
  await join("beatriz", "HEAD", ab);
  await join("pedro", "OPERACIONAL", infra);
  await join("claudia", "CLIENTE");

  // Agência Beta, com o seu próprio cadastro.
  const platform = await actorFor(db, "admin");
  const g = await createAgency(platform, { name: `Agência Beta ${uniq()}`, adminName: "Bia Beta", adminEmail: `forn-${uniq()}@beta.dev` });
  const r = await acceptInvitation(auth$, { token: g.invite.token, password: "senha-beta-1" });
  const betaAdmin = (await loadActor(db, r.userId))!;
  const client = await createClient(betaAdmin, { name: "Cliente Beta" });
  const be = await createEvent(betaAdmin, { clientId: client.id, name: "Feira Beta", startsAt: "2027-08-01T09:00", endsAt: "2027-08-03T18:00" });
  beta = { adminUserId: r.userId, eventId: be.id };
});

const sofia = () => actorFor(db, "sofia");
const marina = () => actorFor(db, "marina");
let gerador: string;

describe("cadastro da agência", () => {
  it("a Pré-produção cadastra; o CNPJ não se repete na agência", async () => {
    const s = await createSupplier(await sofia(), ev, {
      cnpj: CNPJ.gerador, companyName: "Geradores Paulista Ltda", tradeName: "GeraSP", contactName: "Rui",
      phone: "(11) 98765-4321", whatsapp: "11987654321", email: "rui@gerasp.dev", city: "Campinas", state: "sp",
      categories: ["INFRAESTRUTURA", "TECNICA"], specialty: "Geradores de 500 kVA",
    });
    gerador = s.id;
    const got = await getSupplier(await sofia(), ev, gerador);
    expect(got.supplier).toMatchObject({ cnpj: digits(CNPJ.gerador), state: "SP", phone: "+5511987654321", categories: ["INFRAESTRUTURA", "TECNICA"] });
    await expectStatus(createSupplier(await marina(), ev, { cnpj: digits(CNPJ.gerador), companyName: "Outro nome" }), 409);
    await expectStatus(createSupplier(await sofia(), ev, { cnpj: "11.222.333/0001-80", companyName: "X" }), 422);
    // O mesmo cadastro aparece pelo Rock: é da agência, não do evento.
    expect((await listSuppliers(await marina(), d.events.rock.id)).items.map((x) => x.id)).toContain(gerador);
  });

  it("busca por nome, CNPJ e categoria", async () => {
    const a = await sofia();
    expect((await listSuppliers(a, ev, { q: "gerasp" })).items.map((x) => x.id)).toEqual([gerador]);
    expect((await listSuppliers(a, ev, { q: "32.045" })).items.map((x) => x.id)).toEqual([gerador]);
    expect((await listSuppliers(a, ev, { category: "ALIMENTACAO" })).items).toHaveLength(0);
  });

  it("o CNPJ não muda; os outros dados a Pré-produção corrige", async () => {
    await expectStatus(updateSupplier(await sofia(), ev, gerador, { cnpj: CNPJ.led }), 422);
    await expectPgError(as("sofia", (tx) => tx.supplier.update({ where: { id: gerador }, data: { cnpj: digits(CNPJ.led) } })), "23514");
    await updateSupplier(await sofia(), ev, gerador, { capacity: "3 eventos por fim de semana" });
    expect((await getSupplier(await sofia(), ev, gerador)).supplier.capacity).toBe("3 eventos por fim de semana");
  });

  it("campo, cliente e outra agência não enxergam o cadastro", async () => {
    for (const p of ["pedro", "claudia", "rafael"] as Person[]) {
      await expectStatus(listSuppliers(await actorFor(db, p), ev), 404);
      expect(await as(p, (tx) => tx.supplier.findMany({ where: { id: gerador } }))).toHaveLength(0);
    }
    const betaAdmin = (await loadActor(db, beta.adminUserId))!;
    expect((await listSuppliers(betaAdmin, beta.eventId)).items).toHaveLength(0);
    expect(await asUser(beta.adminUserId, (tx) => tx.supplier.findMany({ where: { id: gerador } }))).toHaveLength(0);
    await expectStatus(getSupplier(betaAdmin, beta.eventId, gerador), 404);
    // A Beta tem o seu cadastro: o mesmo CNPJ entra lá sem conflito.
    await createSupplier(betaAdmin, beta.eventId, { cnpj: CNPJ.gerador, companyName: "Geradores (Beta)" });
    expect((await listSuppliers(betaAdmin, beta.eventId)).items.map((x) => x.companyName)).toEqual(["Geradores (Beta)"]);
    // E ninguém da Beta grava no cadastro da demonstração.
    await expectPgError(
      asUser(beta.adminUserId, (tx) => tx.supplier.create({ data: { agencyId: d.agency.id, cnpj: digits(CNPJ.som), companyName: "Intruso", createdById: beta.adminUserId } })),
      "42501",
    );
  });

  it("nunca é apagado", async () => {
    await expectPgError(as("marina", (tx) => tx.supplier.deleteMany({ where: { id: gerador } })), "42501");
    expect(await owner.supplier.findUnique({ where: { id: gerador } })).not.toBeNull();
  });
});

describe("bonificação", () => {
  it("só o diretor preenche; o Pré-produtor não vê", async () => {
    await expectStatus(setSupplierBonus(await sofia(), ev, gerador, { kind: "PERCENTUAL", value: 5 }), 403);
    await expectPgError(as("sofia", (tx) => tx.supplierBonus.create({ data: { supplierId: gerador, kind: "PERCENTUAL", value: 5, updatedById: d.users.sofia! } })), "42501");
    await expectStatus(setSupplierBonus(await marina(), ev, gerador, { kind: "PERCENTUAL", value: 120 }), 422);

    const r = await setSupplierBonus(await marina(), ev, gerador, { kind: "PERCENTUAL", value: "5,5", notes: "acima de R$ 50 mil no ano" });
    expect(bonusText(r.bonus!)).toBe("5,5% · acima de R$ 50 mil no ano");
    expect((await getSupplier(await marina(), ev, gerador)).bonus).toMatchObject({ kind: "PERCENTUAL", value: 5.5 });
    expect((await listSuppliers(await marina(), ev)).items.find((x) => x.id === gerador)!.bonus).toMatchObject({ value: 5.5 });

    expect((await getSupplier(await sofia(), ev, gerador)).bonus).toBeNull();
    expect((await listSuppliers(await sofia(), ev)).items.find((x) => x.id === gerador)!.bonus).toBeNull();
    expect(await as("sofia", (tx) => tx.supplierBonus.findMany())).toHaveLength(0);
  });

  it("o Head vê os contratados para a área dele, com a bonificação; os outros não", async () => {
    // Antes da cotação fechar, o Head não vê nada.
    expect(await as("rafael", (tx) => tx.supplierBonus.findMany({ where: { supplierId: gerador } }))).toHaveLength(0);
    expect((await listContractedSuppliers(await actorFor(db, "rafael"), ev)).items).toHaveLength(0);

    // Item da Infraestrutura, cotado e fechado com o gerador.
    const m = await marina();
    const section = await createCostSection(m, ev, { name: "Infra" });
    const item = await createCostItem(m, section.id, { name: "Gerador 500 kVA", quantity: 1 });
    await owner.costItem.update({ where: { id: item.id }, data: { areaId: infra, category: "INFRAESTRUTURA" } });
    const q = await createQuote(await sofia(), ev, { title: "Gerador", briefing: "1 gerador 500 kVA", responsibleId: (await owner.participant.findFirstOrThrow({ where: { eventId: ev, role: "PRE_PRODUTOR" } })).id, costItemId: item.id });
    await markQuoteSent(await sofia(), q.id);
    const quote = await addSupplierQuote(await sofia(), q.id, { cnpj: CNPJ.gerador, companyName: "Geradores Paulista Ltda", contactName: "Rui", phone: "(11) 98765-4321", email: "rui@gerasp.dev", totalValue: 9000 });
    expect(quote).toMatchObject({ supplierId: gerador, newSupplier: false });
    await chooseQuote(m, q.id, { quoteId: quote.id });

    const rafael = await actorFor(db, "rafael");
    const list = await listContractedSuppliers(rafael, ev);
    expect(list.items.map((s) => [s.id, s.bonus?.value, s.items.map((i) => i.name)])).toEqual([[gerador, 5.5, ["Gerador 500 kVA"]]]);
    expect(list.items[0].items[0].code).toMatch(/^EVT\d{3}-INF-\d{3}$/);
    expect(JSON.stringify(list)).not.toMatch(/9000|totalValue|contracted/);
    expect(await as("rafael", (tx) => tx.supplierBonus.findMany({ where: { supplierId: gerador } }))).toHaveLength(1);
    // Só leitura: o Head não mexe na bonificação nem no cadastro.
    expect(await as("rafael", (tx) => tx.supplierBonus.updateMany({ where: { supplierId: gerador }, data: { value: 50, updatedById: d.users.rafael! } }))).toEqual({ count: 0 });
    expect(await as("rafael", (tx) => tx.supplier.updateMany({ where: { id: gerador }, data: { notes: "x" } }))).toEqual({ count: 0 });

    // Head de outra área, Operacional e Cliente: nada.
    expect((await listContractedSuppliers(await actorFor(db, "beatriz"), ev)).items).toHaveLength(0);
    expect(await as("beatriz", (tx) => tx.supplierBonus.findMany())).toHaveLength(0);
    await expectStatus(listContractedSuppliers(await actorFor(db, "pedro"), ev), 404);
    await expectStatus(listContractedSuppliers(await actorFor(db, "claudia"), ev), 404);
    expect(await as("pedro", (tx) => tx.$queryRaw<unknown[]>`SELECT * FROM app.event_contracted_suppliers(${ev}::uuid)`)).toHaveLength(0);
    // O gestor vê todos.
    expect((await listContractedSuppliers(m, ev)).items.map((s) => s.id)).toEqual([gerador]);
  });
});

describe("cotação com o cadastro", () => {
  let request: string;

  it("Novo fornecedor no orçamento entra no cadastro; o mesmo CNPJ depois reaproveita", async () => {
    const s = await sofia();
    const q = await createQuote(s, ev, { title: "Painel de LED", briefing: "Painel 4x2", responsibleId: (await owner.participant.findFirstOrThrow({ where: { eventId: ev, role: "PRE_PRODUTOR" } })).id });
    request = q.id;
    const first = await addSupplierQuote(s, q.id, { cnpj: CNPJ.led, companyName: "LED Brasil Ltda", contactName: "Ana", phone: "(11) 91234-5678", email: "ana@led.dev", totalValue: "12.500,00" });
    expect(first.newSupplier).toBe(true);
    const led = await owner.supplier.findFirstOrThrow({ where: { agencyId: d.agency.id, cnpj: digits(CNPJ.led) } });
    expect(led).toMatchObject({ id: first.supplierId, companyName: "LED Brasil Ltda", contactName: "Ana", createdById: d.users.sofia });

    const q2 = await createQuote(s, ev, { title: "Telão", briefing: "Telão 6x4", responsibleId: (await owner.participant.findFirstOrThrow({ where: { eventId: ev, role: "PRE_PRODUTOR" } })).id });
    const again = await addSupplierQuote(s, q2.id, { cnpj: CNPJ.led, companyName: "LED Brasil", contactName: "Bia", phone: "(11) 91234-0000", email: "bia@led.dev", totalValue: 3000 });
    expect(again).toMatchObject({ supplierId: led.id, newSupplier: false });
    expect(await owner.supplier.count({ where: { agencyId: d.agency.id, cnpj: digits(CNPJ.led) } })).toBe(1);
  });

  it("o formulário traz o cadastro, com os da categoria do item primeiro", async () => {
    const m = await marina();
    const section = await createCostSection(m, ev, { name: "Técnica" });
    const item = await createCostItem(m, section.id, { name: "Som", quantity: 1 });
    await owner.costItem.update({ where: { id: item.id }, data: { category: "TECNICA" } });
    const q = await createQuote(await sofia(), ev, { title: "Som", briefing: "PA", responsibleId: (await owner.participant.findFirstOrThrow({ where: { eventId: ev, role: "PRE_PRODUTOR" } })).id, costItemId: item.id });
    const got = await getQuote(await sofia(), q.id);
    expect(got.suppliers[0]).toMatchObject({ id: gerador, suggested: true });
    expect(got.suppliers.find((x) => x.cnpj === digits(CNPJ.led))).toMatchObject({ suggested: false });
  });

  it("no banco, o orçamento só aponta para fornecedor da agência com o mesmo CNPJ", async () => {
    const other = await owner.supplier.findFirstOrThrow({ where: { cnpj: digits(CNPJ.gerador), agencyId: { not: d.agency.id } } });
    const base = { eventId: ev, requestId: request, position: 3, cnpj: digits(CNPJ.gerador), companyName: "X", phone: "+5511987654321", email: "x@x.dev", contactName: "X", totalValue: 1, createdById: d.users.sofia! };
    await expectPgError(as("sofia", (tx) => tx.supplierQuote.create({ data: { ...base, supplierId: other.id } })), "23514");
    const led = await owner.supplier.findFirstOrThrow({ where: { agencyId: d.agency.id, cnpj: digits(CNPJ.led) } });
    await expectPgError(as("sofia", (tx) => tx.supplierQuote.create({ data: { ...base, supplierId: led.id } })), "23514");
  });

  it("arquivar: só o diretor; arquivado não entra em orçamento novo", async () => {
    const led = await owner.supplier.findFirstOrThrow({ where: { agencyId: d.agency.id, cnpj: digits(CNPJ.led) } });
    await expectStatus(setSupplierArchived(await sofia(), ev, led.id, { archived: true }), 403);
    await expectPgError(as("sofia", (tx) => tx.supplier.update({ where: { id: led.id }, data: { archivedAt: new Date() } })), "42501");

    await setSupplierArchived(await marina(), ev, led.id, { archived: true });
    const s = await sofia();
    expect((await listSuppliers(s, ev)).items.map((x) => x.id)).not.toContain(led.id);
    expect((await listSuppliers(s, ev, { archived: true })).items.map((x) => x.id)).toEqual([led.id]);
    await expectStatus(
      addSupplierQuote(s, request, { cnpj: CNPJ.led, companyName: "LED", contactName: "Ana", phone: "(11) 91234-5678", email: "ana@led.dev", totalValue: 1 }),
      422,
    );
    expect((await getQuote(s, request)).suppliers.map((x) => x.id)).not.toContain(led.id);

    await setSupplierArchived(await marina(), ev, led.id, { archived: false });
    expect((await listSuppliers(s, ev)).items.map((x) => x.id)).toContain(led.id);
  });

  it("a ficha mostra o histórico, com o escolhido marcado", async () => {
    const h = (await getSupplier(await marina(), ev, gerador)).history;
    expect(h.map((x) => [x.title, x.value, x.result])).toEqual([["Gerador", 9000, "ESCOLHIDO"]]);
  });
});
