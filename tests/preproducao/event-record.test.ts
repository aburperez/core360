import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectPgError, expectStatus, ownerDb, type Person } from "../helpers";
import { withUser, type Tx } from "@/server/db/with-user";
import { eventLeaders, getEvent, getEventFinances, updateEvent } from "@/modules/events/events.service";
import { EVENT_STAGES, stageNumber } from "@/lib/event-stages";

/**
 * Ficha completa do evento (fase 1 do roadmap): campos novos, as 11 etapas e
 * os valores, que só a Pré-produção vê e só o gestor grava.
 */

const db = appDb();
const owner = ownerDb();
const d = demo();
const rock = d.events.rock.id;
const P = d.participants;
const as = <T>(p: Person, fn: (tx: Tx) => Promise<T>) => withUser(db, d.users[p]!, fn);

let before: Awaited<ReturnType<typeof owner.event.findUniqueOrThrow>>;

beforeAll(async () => {
  before = await owner.event.findUniqueOrThrow({ where: { id: rock } });
});

afterAll(async () => {
  const rest: Partial<typeof before> = { ...before };
  delete rest.id; delete rest.createdAt; delete rest.updatedAt;
  await owner.event.update({ where: { id: rock }, data: rest });
  await owner.eventFinances.deleteMany({ where: { eventId: rock } });
  await Promise.all([db.$disconnect(), owner.$disconnect()]);
});

describe("etapas", () => {
  it("são 11, na ordem do roadmap, e Cancelado fica de fora da contagem", () => {
    expect(EVENT_STAGES.map((s) => s.key)).toEqual([
      "BRIEFING", "PLANEJAMENTO", "ORCAMENTO", "APROVACAO", "CONTRATACAO", "PRE_PRODUCAO", "MONTAGEM", "EVENTO", "DESMONTAGEM", "FECHAMENTO", "CONCLUIDO",
    ]);
    expect(stageNumber("PRE_PRODUCAO")).toBe(6);
    expect(stageNumber("CANCELADO")).toBeNull();
  });
});

describe("ficha do evento", () => {
  it("o Gerente preenche a ficha; todos do evento veem, menos os valores", async () => {
    const marina = await actorFor(db, "marina");
    await updateEvent(marina, rock, {
      status: "CONTRATACAO", project: "Turnê 2027", eventType: "Festival", city: "São Paulo", state: "sp",
      setupStartsAt: "2027-04-07T08:00", setupEndsAt: "2027-04-09T22:00", teardownStartsAt: "2027-04-13T06:00", teardownEndsAt: "",
      expectedAudience: "20000", leadId: P.marina.id, producerId: P.sofia.id, notes: "Evento com 3 palcos",
      approvedBudget: "480.000,00", costCenter: "07 Produção",
    });
    const e = await getEvent(await actorFor(db, "joao"), rock);
    expect(e).toMatchObject({
      status: "CONTRATACAO", project: "Turnê 2027", eventType: "Festival", city: "São Paulo", state: "SP", expectedAudience: 20000,
      teardownEndsAt: null, lead: { name: P.marina.name }, notes: "Evento com 3 palcos",
    });
    // O campo não enxerga quem é só da pré-produção; o gestor vê o produtor.
    expect(e.producer).toBeNull();
    expect((await getEvent(marina, rock)).producer).toMatchObject({ name: P.sofia.name });
    // 08:00 em São Paulo = 11:00 UTC.
    expect(e.setupStartsAt?.toISOString()).toBe("2027-04-07T11:00:00.000Z");
    expect(e).not.toHaveProperty("approvedBudget");

    expect(await getEventFinances(await actorFor(db, "sofia"), rock)).toEqual({ approvedBudget: 480000, costCenter: "07 Produção" });
    expect(await getEventFinances(await actorFor(db, "admin"), rock)).toEqual({ approvedBudget: 480000, costCenter: "07 Produção" });
    for (const who of ["rafael", "joao", "claudia"] as const) expect(await getEventFinances(await actorFor(db, who), rock)).toBeNull();
    expect(await owner.auditLog.count({ where: { entity: "event_finances", entityId: rock } })).toBeGreaterThan(0);

    // Mandar só um campo não apaga os outros; esvaziar o orçamento grava nulo.
    await updateEvent(marina, rock, { approvedBudget: "" });
    expect(await getEventFinances(marina, rock)).toEqual({ approvedBudget: null, costCenter: "07 Produção" });
    expect((await getEvent(marina, rock)).project).toBe("Turnê 2027");
  });

  it("recusa dado errado", async () => {
    const marina = await actorFor(db, "marina");
    await expectStatus(updateEvent(marina, rock, { leadId: P.joao.id }), 422);
    await expectStatus(updateEvent(marina, rock, { producerId: P.rafael.id }), 422);
    await expectStatus(updateEvent(marina, rock, { producerId: "00000000-0000-7000-8000-000000000000" }), 422);
    await expectStatus(updateEvent(marina, rock, { state: "São Paulo" }), 422);
    await expectStatus(updateEvent(marina, rock, { expectedAudience: "-5" }), 422);
    await expectStatus(updateEvent(marina, rock, { setupStartsAt: "2027-04-09T08:00", setupEndsAt: "2027-04-08T08:00" }), 422);
    await expectStatus(updateEvent(marina, rock, { approvedBudget: "muito" }), 422);
    await expectStatus(updateEvent(marina, rock, { status: "OPERACAO" }), 422);
    await expectStatus(updateEvent(marina, rock, { startsAt: "" }), 422);
  });

  it("só o Gerente e o Admin mudam a ficha; o Pré-produtor só vê os valores", async () => {
    for (const who of ["sofia", "rafael", "joao", "claudia"] as const) {
      await expectStatus(updateEvent(await actorFor(db, who), rock, { notes: "x" }), 403);
      await expectStatus(updateEvent(await actorFor(db, who), rock, { approvedBudget: "1" }), 403);
    }
    await expectStatus(updateEvent(await actorFor(db, "paulo"), rock, { notes: "x" }), 404);
    await updateEvent(await actorFor(db, "admin"), rock, { costCenter: "01 Infra" });
    expect((await getEventFinances(await actorFor(db, "sofia"), rock))?.costCenter).toBe("01 Infra");
  });

  it("quem pode ser responsável: Gerente ou Pré-produtor ativo", async () => {
    const roles = (await eventLeaders(await actorFor(db, "marina"), rock)).map((p) => p.role);
    expect(roles.length).toBeGreaterThan(0);
    expect(new Set(roles)).toEqual(new Set(["GERENTE", "PRE_PRODUTOR"]));
  });
});

describe("no banco", () => {
  it("o campo não lê os valores e só o gestor grava; o gatilho confere o responsável", async () => {
    await updateEvent(await actorFor(db, "marina"), rock, { approvedBudget: "1000" });
    for (const who of ["rafael", "joao", "claudia", "paulo"] as const) {
      expect(await as(who, (tx) => tx.eventFinances.count({ where: { eventId: rock } }))).toBe(0);
    }
    expect(await as("sofia", (tx) => tx.eventFinances.count({ where: { eventId: rock } }))).toBe(1);
    expect((await as("sofia", (tx) => tx.eventFinances.updateMany({ where: { eventId: rock }, data: { costCenter: "x", updatedById: d.users.sofia! } }))).count).toBe(0);
    await expectPgError(as("marina", (tx) => tx.eventFinances.update({ where: { eventId: rock }, data: { costCenter: "x", updatedById: d.users.sofia! } })), "42501");
    await expectPgError(as("marina", (tx) => tx.event.update({ where: { id: rock }, data: { leadId: P.joao.id } })), "23514");
  });

  it("evento Concluído não é aberto (o diretor não entra)", async () => {
    await owner.event.update({ where: { id: rock }, data: { status: "CONCLUIDO" } });
    const [r] = await owner.$queryRaw<{ open: boolean }[]>`SELECT app.event_is_open(${rock}::uuid) AS open`;
    expect(r!.open).toBe(false);
    await owner.event.update({ where: { id: rock }, data: { status: "EVENTO" } });
    const [s] = await owner.$queryRaw<{ open: boolean }[]>`SELECT app.event_is_open(${rock}::uuid) AS open`;
    expect(s!.open).toBe(true);
  });
});
