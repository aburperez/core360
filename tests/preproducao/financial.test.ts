import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectPgError, expectStatus, ownerDb, type Person } from "../helpers";
import { memoryStorage, setStorageForTests } from "@/server/storage/storage";
import { createEvent, updateEvent } from "@/modules/events/events.service";
import { createCostItem, createCostSection, deleteCostItem, deleteCostSection, updateCostItem } from "@/modules/costs/costs.service";
import { closeFinancial, getFinancialClosing, reopenFinancial, updatePayment } from "@/modules/finance/closing.service";
import { listPendencies } from "@/modules/pendencies/pendencies.service";

/**
 * Fase 7B: o produtor executivo (Gerente do evento) e o diretor marcam o
 * pagamento de cada item e, no Fechamento, fecham o financeiro. Fechado, os
 * valores travam; reabrir pede motivo. Concluído só com o financeiro fechado.
 */

const db = appDb();
const owner = ownerDb();
const d = demo();

let ev: string;
let section: string;
let palco: string;
let som: string;
let luz: string;

const stage = (status: "PRE_PRODUCAO" | "FECHAMENTO" | "CONCLUIDO") => owner.event.update({ where: { id: ev }, data: { status } });

beforeAll(async () => {
  setStorageForTests(memoryStorage());
  ev = (await createEvent(await actorFor(db, "admin"), { clientId: d.clients.rock.id, name: "Feira do financeiro", startsAt: "2027-12-01T10:00", endsAt: "2027-12-02T22:00" })).id;
  const infra = (await owner.area.create({ data: { eventId: ev, name: "Infra" } })).id;
  const team = (await owner.team.create({ data: { eventId: ev, areaId: infra, name: "Palco" } })).id;
  const join = (p: Person, role: "GERENTE" | "PRE_PRODUTOR" | "HEAD" | "OPERACIONAL", areaId?: string, teamId?: string) =>
    owner.participant.create({ data: { eventId: ev, userId: d.users[p]!, name: p, email: `${p}-fin@rockfestival.dev`, role, areaId, teamId, joinedAt: new Date() } });
  await join("marina", "GERENTE");
  await join("sofia", "PRE_PRODUTOR");
  await join("rafael", "HEAD", infra);
  await join("pedro", "OPERACIONAL", infra, team);

  const m = await actorFor(db, "marina");
  section = (await createCostSection(m, ev, { name: "Estruturas" })).id;
  palco = (await createCostItem(m, section, { name: "Palco 12x8", quantity: 1, frequency: 1, unitValue: 50_000 })).id;
  som = (await createCostItem(m, section, { name: "Som", quantity: 1, frequency: 1, unitValue: 20_000 })).id;
  luz = (await createCostItem(m, section, { name: "Luz", quantity: 1, frequency: 1, unitValue: 10_000 })).id; // não contratada: fica fora
  await updateCostItem(m, palco, { contractedValue: 45_000 });
  await updateCostItem(m, som, { contractedValue: 20_000, actualValue: 22_500 });
});

afterAll(async () => {
  await owner.$executeRaw`DELETE FROM event_archives WHERE event_id = ${ev}::uuid`;
  await owner.event.update({ where: { id: ev }, data: { deletedAt: new Date() } });
  await Promise.all([db.$disconnect(), owner.$disconnect()]);
});

describe("quem faz", () => {
  it("o executivo (Gerente) e o diretor; os outros não acham a tela", async () => {
    for (const p of ["marina", "admin"] as const) {
      const c = await getFinancialClosing(await actorFor(db, p), ev);
      expect(c.items.map((i) => i.name)).toEqual(["Palco 12x8", "Som"]);
      expect(c.leftOut).toBe(1);
    }
    for (const p of ["sofia", "rafael", "pedro"] as const) {
      const a = await actorFor(db, p);
      await expectStatus(getFinancialClosing(a, ev), 404);
      await expectStatus(updatePayment(a, palco, { actualValue: 45_000 }), 404);
      await expectStatus(closeFinancial(a, ev), 404);
    }
  });

  it("no banco, a Pré-produção não marca pagamento", async () => {
    const s = await actorFor(db, "sofia");
    await expectPgError(s.run((tx) => tx.costItem.update({ where: { id: luz }, data: { paidOn: new Date("2027-12-03") } })), "42501");
  });
});

describe("pagamentos", () => {
  it("pago pede o realizado; estouro pede o motivo", async () => {
    const m = await actorFor(db, "marina");
    await expectStatus(updatePayment(m, palco, { paidOn: "2027-12-03" }), 422);
    await expectStatus(updatePayment(m, som, { paidOn: "2027-12-03" }), 422); // 22.500 > 20.000 sem motivo
    await updatePayment(m, som, { paidOn: "2027-12-03", invoiceNumber: "NF 1234", overrunReason: "Hora extra da equipe de som" });

    const c = await getFinancialClosing(m, ev);
    expect(c.totals).toMatchObject({ contracted: 65_000, actual: 22_500, paid: 22_500, toPay: 45_000, overrun: 2_500, overruns: 1, justified: 1, pending: 1 });
    expect(c.items.find((i) => i.id === som)).toMatchObject({ paidOn: "2027-12-03", invoiceNumber: "NF 1234", diff: 2_500, missing: [] });
    expect(c.items.find((i) => i.id === palco)!.missing).toEqual(["REALIZADO", "PAGAMENTO"]);
  });

  it("sem estar no Fechamento ou com item pendente, não fecha (nem direto no banco)", async () => {
    const m = await actorFor(db, "marina");
    await expectStatus(closeFinancial(m, ev), 409);
    await stage("FECHAMENTO");
    await expectStatus(closeFinancial(m, ev), 409);
    await expectPgError(
      m.run((tx) => tx.eventFinances.upsert({
        where: { eventId: ev },
        create: { eventId: ev, updatedById: d.users.marina!, financialClosedAt: new Date(), financialClosedBy: d.users.marina! },
        update: { updatedById: d.users.marina!, financialClosedAt: new Date(), financialClosedBy: d.users.marina! },
      })),
      "23514",
    );
  });

  it("a Central de pendências mostra Fechar o financeiro só para o diretor", async () => {
    const mine = await listPendencies(await actorFor(db, "marina"), ev);
    expect(mine.items.find((p) => p.kind === "FINANCEIRO")).toMatchObject({ title: "Fechar o financeiro", href: `/eventos/${ev}/pre-producao/financeiro` });
    const hers = await listPendencies(await actorFor(db, "sofia"), ev);
    expect(hers.items.some((p) => p.kind === "FINANCEIRO")).toBe(false);
  });

  it("o evento não vai para Concluído com o financeiro aberto", async () => {
    const m = await actorFor(db, "marina");
    await expectStatus(updateEvent(m, ev, { status: "CONCLUIDO" }), 409);
    await expectPgError(m.run((tx) => tx.event.update({ where: { id: ev }, data: { status: "CONCLUIDO" } })), "23514");
  });
});

describe("fechado", () => {
  it("com tudo pago, fecha", async () => {
    const m = await actorFor(db, "marina");
    await updatePayment(m, palco, { actualValue: 44_000, paidOn: "2027-12-04" });
    const before = await getFinancialClosing(m, ev);
    expect(before.can.close).toBe(true);
    expect(before.totals).toMatchObject({ paid: 66_500, toPay: 0, below: 1_000, pending: 0 });
    await closeFinancial(m, ev);
    const after = await getFinancialClosing(m, ev);
    expect(after.closed).toMatchObject({ at: expect.any(Date), by: expect.any(String) });
    expect(after.can).toEqual({ edit: false, close: false, reopen: true });
    expect((await listPendencies(m, ev)).items.some((p) => p.kind === "FINANCEIRO")).toBe(false);
  });

  it("os valores travam em todas as telas e no banco; o resto do item muda", async () => {
    const m = await actorFor(db, "marina");
    await expectStatus(updatePayment(m, palco, { invoiceNumber: "NF 9" }), 409);
    await expectStatus(updateCostItem(m, palco, { actualValue: 1 }), 409);
    await expectStatus(updateCostItem(m, luz, { unitValue: 1 }), 409);
    await expectStatus(createCostItem(m, section, { name: "Gerador", quantity: 1 }), 409);
    await expectStatus(deleteCostItem(m, luz), 409);
    await expectStatus(deleteCostSection(m, section), 409);
    await expectStatus(updateEvent(m, ev, { approvedBudget: "100000" }), 409);
    await expectPgError(m.run((tx) => tx.costItem.update({ where: { id: palco }, data: { contractedValue: 1 } })), "23514");
    await expectPgError(m.run((tx) => tx.costItem.delete({ where: { id: luz } })), "23514");
    await updateCostItem(m, palco, { notes: "Montado sem problemas" });
    await updateEvent(m, ev, { notes: "Evento fechado" });
  });

  it("com o financeiro fechado, o evento vai para Concluído; Concluído não reabre", async () => {
    const m = await actorFor(db, "marina");
    await updateEvent(m, ev, { status: "CONCLUIDO" });
    await expectStatus(reopenFinancial(m, ev, { reason: "Nota fiscal errada" }), 409);
    await stage("FECHAMENTO");
  });

  it("reabrir pede motivo e só o executivo ou o diretor; depois, destrava", async () => {
    const m = await actorFor(db, "marina");
    await expectStatus(reopenFinancial(m, ev, { reason: "" }), 422);
    await expectStatus(reopenFinancial(await actorFor(db, "sofia"), ev, { reason: "Nota fiscal errada" }), 404);
    await reopenFinancial(m, ev, { reason: "Nota fiscal errada do palco" });
    const log = await owner.auditLog.findFirst({ where: { eventId: ev, entity: "event_finances" }, orderBy: { occurredAt: "desc" } });
    expect(log!.after).toMatchObject({ financial: "ABERTO", reason: "Nota fiscal errada do palco" });
    await updatePayment(m, palco, { invoiceNumber: "NF 5678" });
    expect((await getFinancialClosing(m, ev)).closed).toBeNull();
  });
});
