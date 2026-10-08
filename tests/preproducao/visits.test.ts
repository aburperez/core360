import { afterAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectPgError, expectStatus, type Person } from "../helpers";
import { withUser, type Tx } from "@/server/db/with-user";
import { createVisit, deleteVisit, listVisits, updateVisit, visitsSummary } from "@/modules/visits/visits.service";
import { DEFAULT_VISIT_PPE, MONTAGEM_PPE } from "@/modules/visits/ppe";

/**
 * Visita técnica (Pré-produção): Sofia (Pré-produtora) marca a visita com data,
 * horário e EPIs; Marina (Gerente) também pode mudar. O campo, o cliente e
 * outro evento não enxergam. Pelo serviço e direto no banco.
 */

const db = appDb();
const d = demo();
afterAll(() => db.$disconnect());

const rock = d.events.rock.id;
const as = <T>(p: Person, fn: (tx: Tx) => Promise<T>) => withUser(db, d.users[p]!, fn);

describe("EPIs", () => {
  it("lista básica da montagem e o que vem marcado na visita", () => {
    expect(MONTAGEM_PPE.map((p) => p.name)).toEqual(["Capacete", "Calça comprida", "Camiseta", "Sapato de proteção", "Protetor auricular"]);
    expect(MONTAGEM_PPE.find((p) => p.name === "Protetor auricular")?.when).toMatch(/externa/);
    expect(DEFAULT_VISIT_PPE).not.toContain("Protetor auricular");
  });
});

describe("Visita técnica", () => {
  let id: string;

  it("Pré-produtora marca a visita com data, horário (fuso do evento) e EPIs", async () => {
    const sofia = await actorFor(db, "sofia");
    const v = await createVisit(sofia, rock, {
      title: "Visita ao autódromo", place: "Portão 7", scheduledAt: "2099-03-10T09:30",
      responsibleId: d.participants.sofia.id, ppe: ["Sapato de proteção", "Capacete"], ppeOther: "Lanterna",
      notes: "Ver pontos de energia e rotas de fuga",
    });
    id = v.id;
    // 09:30 em São Paulo (UTC-3) = 12:30 UTC; EPIs na ordem da lista.
    expect(v.scheduledAt.toISOString()).toBe("2099-03-10T12:30:00.000Z");
    expect(v.ppe).toEqual(["Capacete", "Sapato de proteção"]);
    expect(v.canEdit).toBe(true);

    const list = await listVisits(sofia, rock, new Date("2099-01-01"));
    expect(list.upcoming.map((x) => x.id)).toContain(id);
    expect((await visitsSummary(sofia, rock, new Date("2099-01-01"))).next?.id).toBe(id);
  });

  it("recusa EPI fora da lista, data inválida e quem não é da Pré-produção (serviço e banco)", async () => {
    const sofia = await actorFor(db, "sofia");
    const base = { title: "x", scheduledAt: "2099-03-10T09:30", responsibleId: d.participants.sofia.id };
    await expectStatus(createVisit(sofia, rock, { ...base, ppe: ["Chinelo"] }), 422);
    await expectStatus(createVisit(sofia, rock, { ...base, scheduledAt: "amanhã" }), 422);
    await expectStatus(updateVisit(sofia, id, { responsibleId: d.participants.rafael.id }), 422);
    await expectPgError(
      as("sofia", (tx) => tx.technicalVisit.update({ where: { id }, data: { responsibleId: d.participants.rafael.id } })),
      "23514",
    );
  });

  it("campo, cliente e outro evento não enxergam", async () => {
    for (const p of ["rafael", "joao", "claudia", "paulo"] as Person[]) {
      const a = await actorFor(db, p);
      await expectStatus(listVisits(a, rock), 404);
      await expectStatus(updateVisit(a, id, { title: "y" }), 404);
      await expectStatus(deleteVisit(a, id), 404);
      expect(await as(p, (tx) => tx.technicalVisit.findMany({ where: { id } }))).toHaveLength(0);
    }
  });

  it("a Gerente muda a visita; o histórico guarda o que mudou", async () => {
    const marina = await actorFor(db, "marina");
    const v = await updateVisit(marina, id, { scheduledAt: "2099-03-11T14:00", ppe: ["Capacete", "Protetor auricular"] });
    expect(v.scheduledAt.toISOString()).toBe("2099-03-11T17:00:00.000Z");
    expect(v.ppe).toEqual(["Capacete", "Protetor auricular"]);
    expect(v.title).toBe("Visita ao autódromo");
    const log = await as("marina", (tx) => tx.auditLog.findMany({ where: { entity: "technical_visit", entityId: id }, orderBy: { id: "asc" } }));
    expect(log.map((l) => l.action)).toEqual(["CREATE", "UPDATE"]);
  });

  it("outra pessoa da Pré-produção não muda nem apaga visita que não é dela (serviço e banco)", async () => {
    const marina = await actorFor(db, "marina");
    const other = await createVisit(marina, rock, { title: "Visita da Gerente", scheduledAt: "2099-04-01T08:00", responsibleId: d.participants.marina.id });
    const sofia = await actorFor(db, "sofia");
    expect((await listVisits(sofia, rock)).upcoming.find((x) => x.id === other.id)?.canEdit).toBe(false);
    await expectStatus(updateVisit(sofia, other.id, { title: "z" }), 403);
    await expectStatus(deleteVisit(sofia, other.id), 403);
    const changed = await as("sofia", (tx) => tx.technicalVisit.updateMany({ where: { id: other.id }, data: { title: "z" } }));
    expect(changed.count).toBe(0);
    const removed = await as("sofia", (tx) => tx.technicalVisit.deleteMany({ where: { id: other.id } }));
    expect(removed.count).toBe(0);
    await deleteVisit(marina, other.id);
  });

  it("quem vai apaga a própria visita", async () => {
    const sofia = await actorFor(db, "sofia");
    await deleteVisit(sofia, id);
    expect((await listVisits(sofia, rock, new Date("2099-01-01"))).upcoming.find((x) => x.id === id)).toBeUndefined();
  });
});
