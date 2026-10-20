import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectStatus, ownerDb, type Person, grantAllSections } from "../helpers";
import { createEvent, updateEvent } from "@/modules/events/events.service";
import { createCostItem, createCostSection, updateCostItem } from "@/modules/costs/costs.service";
import { eventComparison, priceBank, similarPrices, supplierRanking } from "@/modules/intelligence/intelligence.service";
import type { ClosureSummary } from "@/modules/closure/closure.service";

/**
 * Fase 7C: o diretor (Admin da agência) vê o ranking dos fornecedores, o
 * banco de preços de todos os eventos (os guardados e o resumo dos
 * encerrados) e o comparativo. Na cotação, o Gerente vê os preços pagos em
 * outros eventos. Ninguém mais vê preços de outros eventos, nem no banco.
 */

const db = appDb();
const owner = ownerDb();
const d = demo();

let agencyId: string;
let atual: string; // o evento onde a Marina é Gerente
let outro: string; // um evento anterior, ainda guardado no app
let encerrado: string; // encerrado e excluído: só o resumo
const suppliers: string[] = [];

/** CNPJ válido a partir de 12 dígitos. */
function cnpj(base: string) {
  const digit = (s: string, w: number[]) => {
    const r = s.split("").reduce((a, c, i) => a + Number(c) * w[i]!, 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = digit(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digit(base + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base}${d1}${d2}`;
}

beforeAll(async () => {
  const creator = await actorFor(db, "admin");
  const mk = (name: string, startsAt: string, endsAt: string) => createEvent(creator, { clientId: d.clients.rock.id, name, startsAt, endsAt }).then((e) => e.id);
  atual = await mk("Feira da inteligência 2028", "2028-03-01T10:00", "2028-03-02T22:00");
  outro = await mk("Feira da inteligência 2027", "2027-03-01T10:00", "2027-03-02T22:00");
  encerrado = await mk("Feira da inteligência 2026", "2026-03-01T10:00", "2026-03-02T22:00");
  agencyId = (await owner.event.findUniqueOrThrow({ where: { id: atual }, select: { agencyId: true } })).agencyId;

  const join = (ev: string, p: Person, role: "GERENTE" | "PRE_PRODUTOR") =>
    owner.participant.create({ data: { eventId: ev, userId: d.users[p]!, name: p, email: `${p}-intel@rockfestival.dev`, role, joinedAt: new Date() } });
  await join(atual, "marina", "GERENTE");
  await join(atual, "sofia", "PRE_PRODUTOR");
  await grantAllSections(owner, atual);

  const admin = await actorFor(db, "admin"); // de novo, já com os eventos novos
  // O evento anterior: palco, som e um opcional, com 2.000 pessoas previstas.
  await updateEvent(admin, outro, { expectedAudience: 2000 });
  const sec = (await createCostSection(admin, outro, { name: "Estruturas" })).id;
  const item = async (name: string, values: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
    const id = (await createCostItem(admin, sec, { name, quantity: 1, frequency: 1, unitValue: 10_000, ...extra })).id;
    await updateCostItem(admin, id, values);
    return id;
  };
  await item("Palco inteligência 12x8 m", { category: "CENOGRAFIA", unit: "UN", contractedValue: 40_000, actualValue: 42_000 }, { unitValue: 45_000 });
  await item("Som inteligência line array", { category: "AUDIOVISUAL", contractedValue: 18_000 });
  await item("Tenda inteligência extra", { category: "CENOGRAFIA", contractedValue: 9_000 }, { optional: true });
  await item("Gerador inteligência reserva", { category: "INFRAESTRUTURA" }); // sem preço: fica fora do banco

  // O encerrado: o resumo guarda os preços dos itens.
  const summary: ClosureSummary = {
    name: "Feira da inteligência 2026", client: "Rock Produções", startsAt: "2026-03-01T13:00:00.000Z", endsAt: "2026-03-03T01:00:00.000Z",
    timezone: "America/Sao_Paulo", venue: null,
    totals: { items: 1, estimated: 30_000, quoted: 0, contracted: 30_000, actual: 30_000, saving: 0, overrun: 0 },
    approved: null, ratings: [], counts: { people: 0, occurrences: 0, suppliers: 0, files: 0 },
    items: [{
      code: "EVT900-CEN-001", name: "Palco inteligência 10x6", category: "CENOGRAFIA", quantity: 2, unit: "UN", optional: false,
      estimated: 30_000, quoted: null, contracted: 30_000, actual: null, supplier: "Palcos Arquivo",
    }],
  };
  await owner.event.update({ where: { id: encerrado }, data: { status: "CONCLUIDO", expectedAudience: 1000 } });
  await owner.eventArchive.upsert({
    where: { eventId: encerrado },
    create: { eventId: encerrado, agencyId, closedAt: new Date(), closedBy: d.users.admin!, summary },
    update: { closedAt: new Date(), closedBy: d.users.admin!, summary },
  });

  // Dois fornecedores avaliados: o primeiro com notas mais altas.
  for (const [i, [name, score]] of ([["Alfa Palcos Inteligência", 9], ["Beta Palcos Inteligência", 6]] as const).entries()) {
    const s = await owner.supplier.create({
      data: { agencyId, cnpj: cnpj(`7788${String(i).padStart(4, "0")}0001`), companyName: name, categories: ["CENOGRAFIA"], createdById: d.users.admin! },
    });
    suppliers.push(s.id);
    await owner.supplierRating.create({
      data: { eventId: outro, supplierId: s.id, quality: score, deadline: score, service: score, cost: score, flexibility: score, problemSolving: score, ratedById: d.users.admin! },
    });
  }
});

afterAll(async () => {
  await owner.supplierRating.deleteMany({ where: { supplierId: { in: suppliers } } });
  await owner.supplier.deleteMany({ where: { id: { in: suppliers } } });
  await owner.$executeRaw`DELETE FROM event_archives WHERE event_id IN (${atual}::uuid, ${outro}::uuid, ${encerrado}::uuid)`;
  await owner.event.updateMany({ where: { id: { in: [atual, outro, encerrado] } }, data: { deletedAt: new Date() } });
  await Promise.all([db.$disconnect(), owner.$disconnect()]);
});

describe("quem vê", () => {
  it("a tela é do diretor da agência; Gerente e Pré-produtor não acham", async () => {
    const admin = await actorFor(db, "admin");
    await supplierRanking(admin, agencyId);
    await priceBank(admin, agencyId);
    await eventComparison(admin, agencyId);
    for (const p of ["marina", "sofia"] as const) {
      const a = await actorFor(db, p);
      await expectStatus(supplierRanking(a, agencyId), 404);
      await expectStatus(priceBank(a, agencyId), 404);
      await expectStatus(eventComparison(a, agencyId), 404);
    }
  });

  it("no banco, os preços dos outros eventos só saem para o Admin e o Gerente", async () => {
    const count = async (p: Person) => {
      const a = await actorFor(db, p);
      const [{ n }] = await a.run((tx) => tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM app.agency_cost_items(${agencyId}::uuid) WHERE event_id = ${outro}::uuid`);
      return Number(n);
    };
    expect(await count("admin")).toBe(4);
    expect(await count("marina")).toBe(4);
    expect(await count("sofia")).toBe(0);
    expect(await count("pedro")).toBe(0);
  });
});

describe("ranking de fornecedores", () => {
  it("ordena pela nota e filtra pela categoria", async () => {
    const admin = await actorFor(db, "admin");
    const r = await supplierRanking(admin, agencyId, { category: "CENOGRAFIA" });
    const names = r.items.map((s) => s.name);
    expect(names.indexOf("Alfa Palcos Inteligência")).toBeLessThan(names.indexOf("Beta Palcos Inteligência"));
    expect(r.items.find((s) => s.name === "Alfa Palcos Inteligência")!.rating).toMatchObject({ overall: 9, ratings: 1 });
    const other = await supplierRanking(admin, agencyId, { category: "AUDIOVISUAL" });
    expect(other.items.some((s) => s.id === suppliers[0])).toBe(false);
    expect(r.byCategory.find((g) => g.category === "CENOGRAFIA")!.top.length).toBeGreaterThan(0);
  });
});

describe("banco de preços", () => {
  it("junta os eventos guardados e os encerrados, só com preço de verdade", async () => {
    const admin = await actorFor(db, "admin");
    const r = await priceBank(admin, agencyId, { q: "inteligencia" });
    const names = r.items.map((i) => i.name);
    expect(names).toContain("Palco inteligência 12x8 m");
    expect(names).toContain("Som inteligência line array");
    expect(names).toContain("Palco inteligência 10x6");
    expect(names).not.toContain("Tenda inteligência extra"); // opcional
    expect(names).not.toContain("Gerador inteligência reserva"); // sem contratado nem realizado

    const palco = r.items.find((i) => i.name === "Palco inteligência 12x8 m")!;
    expect(palco).toMatchObject({ eventId: outro, archived: false, cost: 42_000, paid: true, perUnit: 42_000 });
    const antigo = r.items.find((i) => i.name === "Palco inteligência 10x6")!;
    expect(antigo).toMatchObject({ eventId: encerrado, archived: true, cost: 30_000, paid: false, perUnit: 15_000, supplier: "Palcos Arquivo" });

    const cat = await priceBank(admin, agencyId, { q: "palco inteligencia", category: "CENOGRAFIA" });
    expect(cat.items.map((i) => i.name).sort()).toEqual(["Palco inteligência 10x6", "Palco inteligência 12x8 m"]);
    expect(cat.unitStats).toMatchObject({ unit: "UN", min: 15_000, max: 42_000, n: 2 });
  });

  it("na cotação, o Gerente vê o que foi pago em outros eventos; a Pré-produção não", async () => {
    const m = await actorFor(db, "marina");
    const r = await similarPrices(m, atual, { name: "Palco inteligência 8x6", category: "CENOGRAFIA" });
    expect(r.items.map((i) => i.name)).toEqual(expect.arrayContaining(["Palco inteligência 12x8 m", "Palco inteligência 10x6"]));
    expect(r.items.every((i) => i.eventId !== atual)).toBe(true);
    expect(r.items.some((i) => i.name === "Som inteligência line array")).toBe(false);
    await expectStatus(similarPrices(await actorFor(db, "sofia"), atual, { name: "Palco" }), 404);
    await expectStatus(similarPrices(await actorFor(db, "pedro"), atual, { name: "Palco" }), 404);
  });
});

describe("comparativo entre eventos", () => {
  it("custo, custo por pessoa e categorias de cada evento", async () => {
    const admin = await actorFor(db, "admin");
    const r = await eventComparison(admin, agencyId, { client: "Rock Produções", events: [outro, encerrado] });
    const o = r.events.find((e) => e.id === outro)!;
    // Palco 42.000 (realizado) + Som 18.000 (contratado); a tenda opcional fica fora.
    expect(o).toMatchObject({ cost: 60_000, audience: 2000, perPerson: 30, archived: false, selected: true });
    expect(o.totals).toMatchObject({ contracted: 58_000, actual: 42_000, items: 3 });
    const e = r.events.find((x) => x.id === encerrado)!;
    expect(e).toMatchObject({ cost: 30_000, audience: 1000, perPerson: 30, archived: true });
    expect(r.events.some((x) => x.id === atual)).toBe(false); // sem itens

    expect(r.compared.map((c) => c.id)).toEqual([outro, encerrado]);
    expect(r.compared[0]!.byCategory).toMatchObject({ CENOGRAFIA: 42_000, AUDIOVISUAL: 18_000 });
    const ceno = r.categories.find((c) => c.category === "CENOGRAFIA")!;
    expect(ceno.cost!.n).toBeGreaterThanOrEqual(2);
  });
});
