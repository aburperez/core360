import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectPgError, ownerDb, workerDb, type Person } from "../helpers";
import { memoryStorage, setStorageForTests } from "@/server/storage/storage";
import { createEvent } from "@/modules/events/events.service";
import { createCostItem, createCostSection, updateCostItem } from "@/modules/costs/costs.service";
import { createMilestone, setMilestoneDone } from "@/modules/schedule/schedule.service";
import { createTask } from "@/modules/pendencies/pendencies.service";
import { createArrival } from "@/modules/arrivals/arrivals.service";
import { dispatch } from "@/modules/notifications/dispatcher";

/**
 * Fase 7A: cada pessoa recebe no app um aviso por faixa (7 dias, 3 dias, 48
 * horas, véspera) com os prazos dela; sem responsável, vai para os Gerentes.
 * Depois da montagem, sai o aviso do que não foi montado. Nada se repete.
 */

const db = appDb();
const owner = ownerDb();
const worker = workerDb();
const d = demo();

let ev: string;
let palco: string;
let milestone: string;
const part: Partial<Record<Person, string>> = {};
const at = (s: string) => new Date(`${s}-03:00`);
const run = (now: Date) => worker.$queryRaw`SELECT deadline_alerts(${now}::timestamptz)`;
const notes = async (p: Person) =>
  owner.notification.findMany({ where: { eventId: ev, userId: d.users[p]!, type: "PRAZO" }, orderBy: { createdAt: "asc" } });
const gerentes = async () => (await owner.participant.findMany({ where: { eventId: ev, role: "GERENTE", active: true } })).map((p) => p.userId!);

beforeAll(async () => {
  setStorageForTests(memoryStorage());
  ev = (await createEvent(await actorFor(db, "admin"), { clientId: d.clients.rock.id, name: "Feira dos prazos", startsAt: "2027-11-08T10:00", endsAt: "2027-11-09T22:00" })).id;
  await owner.eventMilestone.deleteMany({ where: { eventId: ev } });
  const infra = (await owner.area.create({ data: { eventId: ev, name: "Infra" } })).id;
  const team = (await owner.team.create({ data: { eventId: ev, areaId: infra, name: "Palco" } })).id;
  const join = async (p: Person, role: "GERENTE" | "PRE_PRODUTOR" | "HEAD" | "OPERACIONAL", areaId?: string, teamId?: string) => {
    part[p] = (await owner.participant.create({ data: { eventId: ev, userId: d.users[p]!, name: p, email: `${p}-pz@rockfestival.dev`, role, areaId, teamId, joinedAt: new Date() } })).id;
  };
  await join("marina", "GERENTE");
  await join("sofia", "PRE_PRODUTOR");
  await join("rafael", "HEAD", infra);
  await join("pedro", "OPERACIONAL", infra, team);

  const m = await actorFor(db, "marina");
  const section = await createCostSection(m, ev, { name: "Estruturas" });
  palco = (await createCostItem(m, section.id, { name: "Palco 12x8", quantity: 1, frequency: 1, unitValue: 50_000 })).id;
  const som = (await createCostItem(m, section.id, { name: "Som", quantity: 1, frequency: 1, unitValue: 20_000 })).id;
  const luz = (await createCostItem(m, section.id, { name: "Luz", quantity: 1, frequency: 1, unitValue: 10_000 })).id;
  await updateCostItem(m, palco, { areaId: infra, neededOn: "2027-11-02", responsibleId: part.rafael });
  await updateCostItem(m, som, { neededOn: "2027-11-05" });
  await updateCostItem(m, luz, { neededOn: "2027-11-03", responsibleId: part.rafael });
  await owner.costItem.update({ where: { id: luz }, data: { status: "PRONTO" } });
  milestone = (await createMilestone(m, ev, { title: "Fechar o som", dueOn: "2027-11-04", responsibleId: part.sofia })).id;
  await createTask(m, ev, { title: "Credenciais da equipe", dueOn: "2027-11-03", responsibleId: part.pedro });
});

afterAll(async () => {
  await owner.event.update({ where: { id: ev }, data: { deletedAt: new Date() } });
  await Promise.all([db.$disconnect(), owner.$disconnect(), worker.$disconnect()]);
});

describe("prazos com data", () => {
  it("cada um recebe os seus, na faixa certa; sem responsável vai para os Gerentes", async () => {
    await run(at("2027-11-01T12:00"));

    const [rafael] = await notes("rafael");
    expect(rafael).toMatchObject({ title: "Prazo amanhã", body: "Palco 12x8 (02/11)", link: `/eventos/${ev}` });
    expect(await notes("rafael")).toHaveLength(1); // a Luz já está pronta

    const [sofia] = await notes("sofia");
    expect(sofia).toMatchObject({ title: "Prazo em 3 dias", body: "Fechar o som (04/11)", link: `/eventos/${ev}/pre-producao/pendencias` });
    const [pedro] = await notes("pedro");
    expect(pedro).toMatchObject({ title: "Prazo em 48 horas", body: "Credenciais da equipe (03/11)" });

    // Som (sem responsável) e o início do evento: um aviso só para cada Gerente.
    const g = await gerentes();
    expect(g).toContain(d.users.marina);
    const all = await owner.notification.findMany({ where: { eventId: ev, type: "PRAZO", userId: { in: g } } });
    expect(all.map((n) => n.userId).sort()).toEqual([...g].sort());
    expect(all[0]).toMatchObject({ title: "Prazo nos próximos 7 dias", body: "Som (05/11), Início do evento (08/11)" });
  });

  it("rodar de novo não repete", async () => {
    const before = await owner.notification.count({ where: { eventId: ev, type: "PRAZO" } });
    await run(at("2027-11-01T12:30"));
    await dispatch({ db: worker, whatsapp: null, now: () => at("2027-11-01T13:00") });
    expect(await owner.notification.count({ where: { eventId: ev, type: "PRAZO" } })).toBe(before);
  });

  it("no dia seguinte, só a faixa nova; o que ficou feito para de avisar", async () => {
    await setMilestoneDone(await actorFor(db, "sofia"), milestone, { done: true });
    await run(at("2027-11-02T09:00"));
    expect((await notes("sofia")).map((n) => n.title)).toEqual(["Prazo em 3 dias"]);
    expect((await notes("pedro")).map((n) => n.title)).toEqual(["Prazo em 48 horas", "Prazo amanhã"]);
    expect((await notes("rafael")).map((n) => n.title)).toEqual(["Prazo amanhã"]); // vence hoje: fica na Central de pendências
    expect((await notes("marina")).map((n) => n.title)).toEqual(["Prazo nos próximos 7 dias", "Prazo em 3 dias"]);
    expect((await notes("marina")).at(-1)!.body).toBe("Som (05/11)");
  });

  it("evento cancelado não avisa", async () => {
    await owner.event.update({ where: { id: ev }, data: { status: "CANCELADO" } });
    const before = await owner.notification.count({ where: { eventId: ev, type: "PRAZO" } });
    await run(at("2027-11-04T09:00"));
    expect(await owner.notification.count({ where: { eventId: ev, type: "PRAZO" } })).toBe(before);
    await owner.event.update({ where: { id: ev }, data: { status: "PRE_PRODUCAO" } });
  });
});

describe("fim da montagem", () => {
  it("avisa o que não foi montado e a chegada que faltou, uma vez", async () => {
    await createArrival(await actorFor(db, "sofia"), ev, { supplierName: "Palco Brasil", scheduledAt: "2027-11-06T08:00", endsAt: "2027-11-06T12:00", itemIds: [palco] });
    await owner.event.update({ where: { id: ev }, data: { setupEndsAt: at("2027-11-07T18:00") } });

    await run(at("2027-11-07T17:00")); // antes do fim: nada
    expect((await notes("marina")).filter((n) => n.title.startsWith("A montagem"))).toHaveLength(0);

    await run(at("2027-11-07T19:00"));
    const m = (await notes("marina")).filter((n) => n.title.startsWith("A montagem"));
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ body: "1 item não montado e 1 chegada não aconteceu", link: `/eventos/${ev}/pre-producao/montagem` });
    const r = (await notes("rafael")).filter((n) => n.title.startsWith("A montagem"));
    expect(r[0]).toMatchObject({ body: "Falta montar Palco 12x8", link: `/eventos/${ev}/montagem` });
    expect(await notes("pedro").then((x) => x.filter((n) => n.title.startsWith("A montagem")))).toHaveLength(0);

    await run(at("2027-11-07T20:00"));
    expect((await notes("marina")).filter((n) => n.title.startsWith("A montagem"))).toHaveLength(1);
  });

  it("um dia depois do fim da montagem, não avisa mais (evento novo no app não recebe aviso velho)", async () => {
    await owner.deadlineAlert.deleteMany({ where: { eventId: ev, kind: "MONTAGEM" } });
    await owner.notification.deleteMany({ where: { eventId: ev, dedupeKey: `montagem:${ev}` } });
    await run(at("2027-11-08T19:00"));
    expect((await notes("marina")).filter((n) => n.title.startsWith("A montagem"))).toHaveLength(0);
  });
});

describe("no banco", () => {
  it("o app não lê nem grava a lista do que já foi avisado", async () => {
    const m = await actorFor(db, "marina");
    await expectPgError(m.run((tx) => tx.deadlineAlert.count({ where: { eventId: ev } })), "42501");
    expect(await owner.deadlineAlert.count({ where: { eventId: ev } })).toBeGreaterThan(0);
  });
});
