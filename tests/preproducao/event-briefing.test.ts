import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectPgError, expectStatus, ownerDb, type Person } from "../helpers";
import { withUser, type Tx } from "@/server/db/with-user";
import { getEventBriefing, saveEventBriefing } from "@/modules/events/briefing.service";
import { BRIEFING_FRONTS } from "@/lib/event-briefing";

/**
 * Briefing do evento (fase 1 do roadmap): cliente, evento, local e as 13
 * frentes. Só a Pré-produção (Gerente, Pré-produtor e Admin) vê e preenche.
 */

const db = appDb();
const owner = ownerDb();
const d = demo();
const rock = d.events.rock.id;
const as = <T>(p: Person, fn: (tx: Tx) => Promise<T>) => withUser(db, d.users[p]!, fn);
const clean = () => Promise.all([
  owner.eventBriefingFront.deleteMany({ where: { eventId: rock } }),
  owner.eventBriefing.deleteMany({ where: { eventId: rock } }),
]);

beforeAll(clean);
afterAll(async () => {
  await clean();
  await Promise.all([db.$disconnect(), owner.$disconnect()]);
});

describe("briefing do evento", () => {
  it("vazio: as 13 frentes na ordem, todas a definir", async () => {
    const b = await getEventBriefing(await actorFor(db, "marina"), rock);
    expect(b.fronts.map((f) => f.key)).toEqual(BRIEFING_FRONTS.map((f) => f.key));
    expect(b.fronts.every((f) => f.needed === null)).toBe(true);
    expect(b.updatedAt).toBeNull();
    expect(b.progress).toMatchObject({ answered: 0, needed: 0, filled: 0 });
  });

  it("a Pré-produtora preenche; o Gerente e o Admin leem", async () => {
    const sofia = await actorFor(db, "sofia");
    await saveEventBriefing(sofia, rock, {
      clientCompany: "Rock Produções", clientResponsible: "Cláudia", objective: "Lançar a turnê", venueRules: "Som até 22h",
      fronts: [
        { key: "AUDIO", needed: true, notes: "PA para 20 mil" },
        { key: "LIMPEZA", needed: false, notes: "" },
      ],
    });
    for (const who of ["marina", "admin"] as const) {
      const b = await getEventBriefing(await actorFor(db, who), rock);
      expect(b).toMatchObject({ clientCompany: "Rock Produções", objective: "Lançar a turnê", concept: null });
      expect(b.fronts.find((f) => f.key === "AUDIO")).toMatchObject({ needed: true, notes: "PA para 20 mil" });
      expect(b.fronts.find((f) => f.key === "LIMPEZA")).toMatchObject({ needed: false, notes: null });
      expect(b.progress).toMatchObject({ answered: 2, needed: 1, filled: 4 });
    }
    expect(await owner.auditLog.count({ where: { entity: "event_briefing", entityId: rock } })).toBe(1);
  });

  it("mandar só um campo não apaga os outros; a frente volta para a definir", async () => {
    const marina = await actorFor(db, "marina");
    await saveEventBriefing(marina, rock, { concept: "Rock clássico", fronts: [{ key: "AUDIO", needed: null, notes: "PA para 20 mil" }] });
    const b = await getEventBriefing(marina, rock);
    expect(b).toMatchObject({ clientCompany: "Rock Produções", concept: "Rock clássico" });
    expect(b.fronts.find((f) => f.key === "AUDIO")?.needed).toBeNull();
    expect(b.fronts.find((f) => f.key === "LIMPEZA")?.needed).toBe(false);
    // Sem mudança, nada é gravado nem auditado.
    const n = await owner.auditLog.count({ where: { entity: "event_briefing", entityId: rock } });
    await saveEventBriefing(marina, rock, { concept: "Rock clássico" });
    expect(await owner.auditLog.count({ where: { entity: "event_briefing", entityId: rock } })).toBe(n);
  });

  it("recusa dado errado", async () => {
    const sofia = await actorFor(db, "sofia");
    await expectStatus(saveEventBriefing(sofia, rock, { fronts: [{ key: "PIROTECNIA", needed: true }] }), 422);
    await expectStatus(saveEventBriefing(sofia, rock, { fronts: [{ key: "AUDIO", needed: "sim" }] }), 422);
    await expectStatus(saveEventBriefing(sofia, rock, { objective: "x".repeat(4001) }), 422);
  });

  it("o campo, o cliente e quem é de fora não veem nem mexem", async () => {
    for (const who of ["rafael", "joao", "claudia", "paulo"] as const) {
      const a = await actorFor(db, who);
      await expectStatus(getEventBriefing(a, rock), 404);
      await expectStatus(saveEventBriefing(a, rock, { objective: "x" }), 404);
    }
  });
});

describe("no banco", () => {
  it("só a Pré-produção lê e grava, e grava em nome próprio", async () => {
    for (const who of ["rafael", "joao", "claudia", "paulo"] as const) {
      expect(await as(who, (tx) => tx.eventBriefing.count({ where: { eventId: rock } }))).toBe(0);
      expect(await as(who, (tx) => tx.eventBriefingFront.count({ where: { eventId: rock } }))).toBe(0);
    }
    expect(await as("sofia", (tx) => tx.eventBriefingFront.count({ where: { eventId: rock } }))).toBe(2);
    await expectPgError(as("joao", (tx) => tx.eventBriefingFront.create({ data: { eventId: rock, front: "VIDEO", needed: true } })), "42501");
    await expectPgError(
      as("sofia", (tx) => tx.eventBriefing.update({ where: { eventId: rock }, data: { concept: "x", updatedById: d.users.marina! } })),
      "42501",
    );
    expect((await as("joao", (tx) => tx.eventBriefing.updateMany({ where: { eventId: rock }, data: { concept: "x" } }))).count).toBe(0);
  });
});
