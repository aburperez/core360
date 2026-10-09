import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectPgError, expectStatus, ownerDb, type Person } from "../helpers";
import { withUser, type Tx } from "@/server/db/with-user";
import { memoryStorage, setStorageForTests } from "@/server/storage/storage";
import { createEvent } from "@/modules/events/events.service";
import { createCostItem, createCostSection, updateCostItem } from "@/modules/costs/costs.service";
import {
  checkReceipt, listReceipts, markChecked, receiptPhoto, sendToField, setAssembled, setItemReceiver, uncheck,
} from "@/modules/receipts/receipts.service";
import { createArrival } from "@/modules/arrivals/arrivals.service";
import { listPendencies } from "@/modules/pendencies/pendencies.service";
import { getSchedule } from "@/modules/schedule/schedule.service";

/**
 * Item até Conferido (fase 5B): depois da chegada (No local), o Head da área
 * do item (ou o gerente) marca Montado e depois Conferido, que pede foto. O
 * item acompanha. Item do mapa de montagem sem Montado no prazo fica atrasado
 * no cronograma e nas pendências. Pelo serviço e direto no banco.
 */

const db = appDb();
const owner = ownerDb();
const d = demo();
const as = <T>(p: Person, fn: (tx: Tx) => Promise<T>) => withUser(db, d.users[p]!, fn);
const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...randomBytes(64)]);

let ev: string;
let infra: string;
let bar: string;
let pedroP: string;
let gerador: string;
let receipt: string;

const status = async () => (await owner.costItem.findUniqueOrThrow({ where: { id: gerador } })).status;
const rows = async (p: Person) => (await listReceipts(await actorFor(db, p), ev)).rows;

beforeAll(async () => {
  setStorageForTests(memoryStorage());
  const e = await createEvent(await actorFor(db, "admin"), { clientId: d.clients.rock.id, name: "Feira do conferido", startsAt: "2027-11-20T10:00", endsAt: "2027-11-21T22:00" });
  ev = e.id;
  infra = (await owner.area.create({ data: { eventId: ev, name: "Infra" } })).id;
  bar = (await owner.area.create({ data: { eventId: ev, name: "Bar" } })).id;
  const team = (await owner.team.create({ data: { eventId: ev, areaId: infra, name: "Energia" } })).id;
  const join = (p: Person, role: "GERENTE" | "PRE_PRODUTOR" | "HEAD" | "OPERACIONAL", areaId?: string, teamId?: string) =>
    owner.participant.create({ data: { eventId: ev, userId: d.users[p]!, name: p, email: `${p}-cf@rockfestival.dev`, role, areaId, teamId, joinedAt: new Date() } });
  await join("marina", "GERENTE");
  await join("sofia", "PRE_PRODUTOR");
  await join("rafael", "HEAD", infra);
  await join("beatriz", "HEAD", bar);
  pedroP = (await join("pedro", "OPERACIONAL", infra, team)).id;

  const m = await actorFor(db, "marina");
  const section = await createCostSection(m, ev, { name: "Energia" });
  gerador = (await createCostItem(m, section.id, { name: "Gerador 300 kVA", quantity: 2, frequency: 1, unitValue: 4_500 })).id;
  await updateCostItem(m, gerador, { areaId: infra, unit: "UN" });
  await setItemReceiver(m, gerador, { participantId: pedroP });
  await sendToField(m, ev);
  receipt = (await owner.itemReceipt.findFirstOrThrow({ where: { costItemId: gerador } })).id;
});

afterAll(async () => {
  await owner.event.update({ where: { id: ev }, data: { deletedAt: new Date() } });
  await Promise.all([db.$disconnect(), owner.$disconnect()]);
});

describe("quem vê e quem marca", () => {
  it("a área vem do item e acompanha quando o item muda de área", async () => {
    expect((await owner.itemReceipt.findUniqueOrThrow({ where: { id: receipt } })).areaId).toBe(infra);
    const s = await actorFor(db, "sofia");
    await updateCostItem(s, gerador, { areaId: bar });
    expect((await owner.itemReceipt.findUniqueOrThrow({ where: { id: receipt } })).areaId).toBe(bar);
    await updateCostItem(s, gerador, { areaId: infra });
    expect((await owner.itemReceipt.findUniqueOrThrow({ where: { id: receipt } })).areaId).toBe(infra);
    // Ninguém muda a área do recebimento direto.
    await expectPgError(as("marina", (tx) => tx.itemReceipt.update({ where: { id: receipt }, data: { areaId: bar } })), "42501");
  });

  it("o Head da área vê o item (sem valores) e pode montar; o Head de outra área nem vê", async () => {
    const [r] = await rows("rafael");
    expect(r).toMatchObject({ id: receipt, areaName: "Infra", canAssemble: true, canReceive: false, receiverName: "pedro" });
    expect(JSON.stringify(r)).not.toMatch(/4500|unitValue/);
    expect(await rows("beatriz")).toHaveLength(0);
    const [mine] = await rows("pedro");
    expect(mine).toMatchObject({ canReceive: true, canAssemble: false });
    expect((await rows("marina"))[0]).toMatchObject({ canReceive: true, canAssemble: true });
  });

  it("o Head não marca a chegada de outra pessoa, e nada se monta antes de chegar", async () => {
    const rafael = await actorFor(db, "rafael");
    await expectStatus(checkReceipt(rafael, receipt, { status: "OK" }), 403);
    await expectPgError(as("rafael", (tx) => tx.itemReceipt.update({ where: { id: receipt }, data: { status: "OK", receivedAt: new Date(), receivedById: d.users.rafael! } })), "42501");
    await expectStatus(setAssembled(rafael, receipt, { done: true }), 422);
    await expectStatus(setAssembled(await actorFor(db, "beatriz"), receipt, { done: true }), 404);
  });
});

describe("chegou, Montado, Conferido", () => {
  it("a chegada põe o item em No local; quem recebe (Operacional) não marca Montado", async () => {
    const pedro = await actorFor(db, "pedro");
    await checkReceipt(pedro, receipt, { status: "OK" });
    expect(await status()).toBe("NO_LOCAL");
    await expectStatus(setAssembled(pedro, receipt, { done: true }), 403);
    await expectPgError(as("pedro", (tx) => tx.itemReceipt.update({ where: { id: receipt }, data: { assembledAt: new Date(), assembledById: d.users.pedro! } })), "42501");
  });

  it("no mapa de montagem, o item não montado depois do prazo fica atrasado no cronograma e nas pendências", async () => {
    const s = await actorFor(db, "sofia");
    await createArrival(s, ev, { supplierName: "Energia Total", scheduledAt: "2027-11-18T08:00", endsAt: "2027-11-18T18:00", itemIds: [gerador] });
    const before = new Date("2027-11-18T12:00:00-03:00");
    const after = new Date("2027-11-18T19:00:00-03:00");

    let p = await listPendencies(s, ev, {}, before);
    expect(p.items.find((x) => x.kind === "MONTAGEM")).toMatchObject({ id: gerador, title: "Montar Gerador 300 kVA", group: "HOJE" });
    p = await listPendencies(s, ev, {}, after);
    expect(p.items.find((x) => x.kind === "MONTAGEM")).toMatchObject({ group: "ATRASADO", area: { id: infra, name: "Infra" } });

    const sched = await getSchedule(s, ev, after);
    expect(sched.items.find((i) => i.id === gerador)?.assembly).toMatchObject({ late: true, done: false });
    expect(sched.assemblyLate).toBe(1);
    expect((await getSchedule(s, ev, before)).items.find((i) => i.id === gerador)?.assembly?.late).toBe(false);
  });

  it("o Head marca Montado; o item vai para Montado e sai do atraso", async () => {
    await setAssembled(await actorFor(db, "rafael"), receipt, { done: true });
    expect(await status()).toBe("MONTADO");
    const s = await actorFor(db, "sofia");
    const after = new Date("2027-11-18T19:00:00-03:00");
    expect((await listPendencies(s, ev, {}, after)).items.some((x) => x.kind === "MONTAGEM")).toBe(false);
    expect((await getSchedule(s, ev, after)).items.find((i) => i.id === gerador)?.assembly).toMatchObject({ late: false, done: true });
    // A montagem fica no nome de quem marcou; quem recebe não desfaz a chegada de um item montado.
    await expectPgError(as("rafael", (tx) => tx.itemReceipt.update({ where: { id: receipt }, data: { assembledById: d.users.marina! } })), "42501");
    await expectStatus(checkReceipt(await actorFor(db, "pedro"), receipt, { status: "PENDENTE" }), 422);
  });

  it("Conferido só com foto: sem foto o banco recusa; com foto o item vai para Conferido", async () => {
    await expectPgError(as("rafael", (tx) => tx.itemReceipt.update({ where: { id: receipt }, data: { checkedAt: new Date(), checkedById: d.users.rafael! } })), "23514");
    const rafael = await actorFor(db, "rafael");
    await markChecked(rafael, receipt, jpeg());
    expect(await status()).toBe("CONFERIDO");
    const [r] = await rows("pedro");
    expect(r!.checkPhotoIds).toHaveLength(1);
    expect(r!.photoIds).toHaveLength(0);
    expect((await receiptPhoto(await actorFor(db, "pedro"), r!.checkPhotoIds[0]!)).mimeType).toBe("image/jpeg");
    await expectStatus(receiptPhoto(await actorFor(db, "beatriz"), r!.checkPhotoIds[0]!), 404);
  });

  it("desfazer volta o item junto, na ordem; Finalizado (do diretor) não volta", async () => {
    const rafael = await actorFor(db, "rafael");
    await expectStatus(setAssembled(rafael, receipt, { done: false }), 422);
    await uncheck(rafael, receipt);
    expect(await status()).toBe("MONTADO");
    await setAssembled(rafael, receipt, { done: false });
    expect(await status()).toBe("NO_LOCAL");

    await setAssembled(rafael, receipt, { done: true });
    await markChecked(rafael, receipt, jpeg());
    await updateCostItem(await actorFor(db, "marina"), gerador, { status: "FINALIZADO" });
    await uncheck(rafael, receipt);
    expect(await status()).toBe("FINALIZADO");
  });
});
