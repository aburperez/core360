import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectStatus, ownerDb, type Person } from "../helpers";
import { memoryStorage, setStorageForTests } from "@/server/storage/storage";
import { createEvent } from "@/modules/events/events.service";
import { createCostItem, createCostSection, updateCostItem } from "@/modules/costs/costs.service";
import { createArrival } from "@/modules/arrivals/arrivals.service";
import { getExecutivePanel, homePriorities, itemStages } from "@/modules/panels/panels.service";

/**
 * Painéis da fase 6A: as prioridades de hoje (cada um no seu escopo, sem
 * valores), as etapas dos itens e o painel executivo, que só o diretor abre.
 */

const db = appDb();
const owner = ownerDb();
const d = demo();

let ev: string;
let infra: string;
let palco: string;
const now = new Date("2027-09-20T15:00:00-03:00");

beforeAll(async () => {
  setStorageForTests(memoryStorage());
  const e = await createEvent(await actorFor(db, "admin"), { clientId: d.clients.rock.id, name: "Feira dos painéis", startsAt: "2027-09-25T10:00", endsAt: "2027-09-26T22:00" });
  ev = e.id;
  infra = (await owner.area.create({ data: { eventId: ev, name: "Infra" } })).id;
  const team = (await owner.team.create({ data: { eventId: ev, areaId: infra, name: "Palco" } })).id;
  const join = (p: Person, role: "GERENTE" | "PRE_PRODUTOR" | "HEAD" | "OPERACIONAL", areaId?: string, teamId?: string) =>
    owner.participant.create({ data: { eventId: ev, userId: d.users[p]!, name: p, email: `${p}-pn@rockfestival.dev`, role, areaId, teamId, joinedAt: new Date() } });
  await join("marina", "GERENTE");
  await join("sofia", "PRE_PRODUTOR");
  await join("rafael", "HEAD", infra);
  await join("pedro", "OPERACIONAL", infra, team);

  const m = await actorFor(db, "marina");
  const section = await createCostSection(m, ev, { name: "Estruturas" });
  palco = (await createCostItem(m, section.id, { name: "Palco 12x8", quantity: 1, frequency: 1, unitValue: 50_000 })).id;
  const tenda = (await createCostItem(m, section.id, { name: "Tenda 10x10", quantity: 2, frequency: 1, unitValue: 5_000 })).id;
  await updateCostItem(m, palco, { areaId: infra, category: "INFRAESTRUTURA", contractedValue: 45_000, actualValue: 48_000, neededOn: "2027-09-10" });
  await updateCostItem(m, tenda, { areaId: infra, category: "INFRAESTRUTURA", contractedValue: 12_000 });
  // Chegada que já devia ter acontecido de manhã.
  await createArrival(await actorFor(db, "sofia"), ev, { supplierName: "Palco Brasil", scheduledAt: "2027-09-20T08:00", endsAt: "2027-09-20T12:00", areaId: infra, itemIds: [palco] });
});

afterAll(async () => {
  await owner.event.update({ where: { id: ev }, data: { deletedAt: new Date() } });
  await Promise.all([db.$disconnect(), owner.$disconnect()]);
});

describe("Meus eventos: prioridades de hoje", () => {
  it("o diretor vê pendências e chegadas atrasadas do evento", async () => {
    const p = (await homePriorities(await actorFor(db, "marina"), [{ id: ev, status: "MONTAGEM" }], now)).get(ev)!;
    expect(p.map((x) => x.text)).toEqual(expect.arrayContaining([expect.stringMatching(/pendências? atrasadas?/), "1 chegada atrasada"]));
    expect(p.find((x) => x.text === "1 chegada atrasada")).toMatchObject({ tone: "red", href: `/eventos/${ev}/montagem` });
  });

  it("o Head vê só o campo dele (sem pendências da Pré-produção) e nada com valor", async () => {
    const p = (await homePriorities(await actorFor(db, "rafael"), [{ id: ev, status: "MONTAGEM" }], now)).get(ev)!;
    expect(p.map((x) => x.text)).toEqual(["1 chegada atrasada"]);
    expect(p.map((x) => x.text).join(" ")).not.toMatch(/R\$|\d{4,}/);
  });

  it("evento concluído ou cancelado não entra", async () => {
    const p = await homePriorities(await actorFor(db, "marina"), [{ id: ev, status: "CONCLUIDO" }], now);
    expect(p.size).toBe(0);
  });
});

describe("painel do produtor", () => {
  it("agrupa as 13 etapas do item em 8 e conta o que já está no local", () => {
    const s = itemStages(["A_DEFINIR", "EM_COTACAO", "EM_APROVACAO", "CONTRATADO", "NO_LOCAL", "MONTADO", "CONFERIDO", "FINALIZADO"]);
    expect(s.total).toBe(8);
    expect(s.atVenue).toBe(4);
    expect(Object.fromEntries(s.groups.map((g) => [g.key, g.count]))).toEqual({
      definir: 1, cotacao: 2, contratado: 1, producao: 0, local: 1, montado: 1, conferido: 1, finalizado: 1,
    });
  });
});

describe("painel executivo", () => {
  it("só o diretor abre: pré-produtora e Head recebem 404", async () => {
    await expectStatus(getExecutivePanel(await actorFor(db, "sofia"), ev, now), 404);
    await expectStatus(getExecutivePanel(await actorFor(db, "rafael"), ev, now), 404);
  });

  it("mostra os 4 valores, os estouros, o que passou do estimado e os riscos", async () => {
    const x = await getExecutivePanel(await actorFor(db, "marina"), ev, now);
    expect(x.totals).toMatchObject({ estimated: 60_000, contracted: 57_000, actual: 48_000, saving: 3_000, overrun: 3_000 });
    expect(x.overruns).toEqual([expect.objectContaining({ id: palco, value: 3_000 })]);
    expect(x.aboveEstimate).toEqual([expect.objectContaining({ name: "Tenda 10x10", value: 2_000 })]);
    expect(x.byCategory[0]).toMatchObject({ key: "INFRAESTRUTURA", estimated: 60_000 });
    expect(x.risks.map((r) => r.text)).toEqual(expect.arrayContaining(["1 item com montagem atrasada", "1 item atrasado para ficar pronto"]));
  });
});
