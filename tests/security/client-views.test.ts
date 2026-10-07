import { afterAll, afterEach, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectPgError, expectStatus, ownerDb, type Person } from "../helpers";
import { withUser, type Tx } from "@/server/db/with-user";
import type { ClientView } from "@/server/authz/actor";
import {
  canAssignRole,
  canManageAreas,
  canManageTeams,
  canSeeArea,
  canSeeOccurrence,
  canSeePlans,
  canSeeTeam,
  canUseField,
  clientCan,
} from "@/server/authz/policy";
import { listClientViews, setClientView } from "@/modules/participants/client-views.service";
import { listAreas } from "@/modules/areas/areas.service";
import { listTeams } from "@/modules/teams/teams.service";
import { listParticipants } from "@/modules/participants/participants.service";
import { changeStatus, getOccurrence, listOccurrences } from "@/modules/occurrences/occurrences.service";
import { addPhoto } from "@/modules/attachments/attachments.service";
import { createCostSection, exportCostSheet, getClientCosts } from "@/modules/costs/costs.service";
import { getDashboard } from "@/modules/dashboard/dashboard.service";
import { setStorageForTests, memoryStorage } from "@/server/storage/storage";

/**
 * Visão do cliente: o Cliente só olha, e só o que o Gerente (ou o Admin)
 * liberar: custos, equipe e andamento. Pelo serviço e direto no banco.
 */

const db = appDb();
const owner = ownerDb();
const d = demo();
const rock = d.events.rock.id;
const claudia = d.participants.claudia.id;
const as = <T>(p: Person, fn: (tx: Tx) => Promise<T>) => withUser(db, d.users[p]!, fn);
const OFF: ClientView = { costs: false, team: false, progress: false };
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1]);

const grant = async (v: Partial<ClientView>) => setClientView(await actorFor(db, "marina"), claudia, { ...OFF, ...v });

// Os outros testes esperam a Cláudia sem nada liberado.
afterEach(() => grant({}));
afterAll(() => Promise.all([db.$disconnect(), owner.$disconnect()]));

describe("quem libera", () => {
  it("só o Gerente do evento ou o Admin; e só para quem é Cliente", async () => {
    expect(await setClientView(await actorFor(db, "admin"), claudia, { team: true })).toMatchObject({ team: true, costs: false });
    for (const p of ["rafael", "joao", "sofia", "claudia"] as const) {
      await expectStatus(setClientView(await actorFor(db, p), claudia, { costs: true }), [403, 404]);
    }
    await expectStatus(setClientView(await actorFor(db, "paulo"), claudia, { costs: true }), [403, 404]);
    await expectStatus(setClientView(await actorFor(db, "marina"), d.participants.joao.id, { costs: true }), 422);
    expect(Object.keys(await listClientViews(await actorFor(db, "rafael"), rock))).toEqual([]);
    expect((await listClientViews(await actorFor(db, "marina"), rock))[claudia]).toMatchObject({ team: true });
    expect(await owner.auditLog.count({ where: { entity: "client_view", entityId: claudia } })).toBeGreaterThan(0);
  });

  it("no banco: o Head não libera, ninguém assina pelo outro, e visão só para Cliente", async () => {
    const row = { eventId: rock, participantId: claudia, costs: true, team: true, progress: true };
    expect((await as("rafael", (tx) => tx.clientView.updateMany({ where: { participantId: claudia }, data: { costs: true, updatedById: d.users.rafael! } }))).count).toBe(0);
    await expectPgError(
      as("marina", (tx) => tx.clientView.upsert({ where: { participantId: claudia }, create: { ...row, updatedById: d.users.paulo! }, update: { costs: true, updatedById: d.users.paulo! } })),
      "42501",
    );
    await expectPgError(
      owner.clientView.create({ data: { eventId: rock, participantId: d.participants.joao.id, updatedById: d.users.marina! } }),
      "23514",
    );
    // A Cláudia lê a própria visão, mas não muda.
    expect(await as("claudia", (tx) => tx.clientView.count({ where: { participantId: claudia } }))).toBe(1);
    expect((await as("claudia", (tx) => tx.clientView.updateMany({ where: { participantId: claudia }, data: { costs: true, updatedById: d.users.claudia! } }))).count).toBe(0);
  });
});

describe("o que o Cliente vê", () => {
  it("sem nada liberado: só a si mesma, sem equipe, chamados, planta ou custos", async () => {
    const c = await actorFor(db, "claudia");
    expect(await listAreas(c, rock)).toEqual([]);
    expect(await listTeams(c, rock)).toEqual([]);
    expect((await listParticipants(c, rock)).map((p) => p.id)).toEqual([claudia]);
    expect(await listOccurrences(c, rock)).toEqual([]);
    await expectStatus(getClientCosts(c, rock), 404);
    await expectStatus(exportCostSheet(c, rock), 404);
    expect(await getDashboard(c, rock)).toMatchObject({ role: "CLIENTE", views: OFF, structure: null, progress: null });
    expect(await as("claudia", (tx) => tx.area.count({ where: { eventId: rock } }))).toBe(0);
    expect(await as("claudia", (tx) => tx.costItem.count({ where: { eventId: rock } }))).toBe(0);
  });

  it("equipe: áreas, equipes e pessoas, sem a ficha e sem chamados", async () => {
    await grant({ team: true });
    const c = await actorFor(db, "claudia");
    expect((await listAreas(c, rock)).length).toBeGreaterThan(1);
    expect((await listTeams(c, rock)).length).toBeGreaterThan(1);
    expect((await listParticipants(c, rock)).map((p) => p.id)).toContain(d.participants.joao.id);
    expect(await as("claudia", (tx) => tx.participantProfile.count({ where: { eventId: rock } }))).toBe(0);
    expect(await listOccurrences(c, rock)).toEqual([]);
    expect((await getDashboard(c, rock)) as { structure: unknown }).toMatchObject({ structure: { areas: expect.any(Number) } });
  });

  it("andamento: vê os chamados, mas não muda nada nem anexa foto", async () => {
    setStorageForTests(memoryStorage());
    await grant({ progress: true });
    const c = await actorFor(db, "claudia");
    expect((await listOccurrences(c, rock)).length).toBeGreaterThan(0);
    const id = d.occurrences.chopeira.id;
    const o = await getOccurrence(c, id);
    expect(o.can).toEqual({ work: false, manage: false, validate: false, conclude: false, claim: false, watchOnly: true });
    await expectStatus(changeStatus(c, id, { status: "EM_ANDAMENTO" }), [403, 422]);
    await expectStatus(addPhoto(c, id, { bytes: JPG }), 403);
    // A equipe só aparece com "Equipe" ligada; os nomes de área do chamado, sim.
    expect((await listParticipants(c, rock)).map((p) => p.id)).toEqual([claudia]);
    // Direto no banco.
    expect((await as("claudia", (tx) => tx.occurrence.updateMany({ where: { id }, data: { title: "x" } }))).count).toBe(0);
    await expectPgError(
      as("claudia", (tx) => tx.attachment.create({
        data: { occurrenceId: id, eventId: rock, storageKey: "x", mimeType: "image/jpeg", sizeBytes: 1, sha256: "x".repeat(64), uploadedById: d.users.claudia!, kind: "EVIDENCIA" },
      })),
      "42501",
    );
    // O Cliente não recebe avisos de chamado nem vira responsável.
    await expectStatus(listOccurrences(c, d.events.congresso.id), 404);
  });

  it("custos: lê a planilha com valores e baixa o Excel, mas não altera", async () => {
    await grant({ costs: true });
    const c = await actorFor(db, "claudia");
    const sheet = await getClientCosts(c, rock);
    expect(sheet).toHaveProperty("totals.total");
    expect(JSON.stringify(sheet)).not.toMatch(/receiver|receipt/);
    expect((await exportCostSheet(c, rock)).bytes.length).toBeGreaterThan(0);
    await expectStatus(createCostSection(c, rock, { name: "Hack" }), 404);
    await expectPgError(as("claudia", (tx) => tx.costSection.create({ data: { eventId: rock, name: "Hack", position: 99 } })), "42501");
    expect(await listOccurrences(c, rock)).toEqual([]);
  });

  it("fechar a visão tira o acesso na hora", async () => {
    await grant({ progress: true, team: true, costs: true });
    await grant({});
    const c = await actorFor(db, "claudia");
    expect(await listOccurrences(c, rock)).toEqual([]);
    expect(await listAreas(c, rock)).toEqual([]);
    await expectStatus(getClientCosts(c, rock), 404);
  });
});

describe("paridade backend × banco para o Cliente", () => {
  const combos: Partial<ClientView>[] = [{}, { team: true }, { progress: true }, { costs: true }, { team: true, progress: true, costs: true }];
  for (const v of combos) {
    it(JSON.stringify(v), async () => {
      await grant(v);
      const a = await actorFor(db, "claudia");
      const bad: string[] = [];
      await as("claudia", async (tx) => {
        const q = async (sql: string, ...args: unknown[]) => (await tx.$queryRawUnsafe<{ r: boolean }[]>(sql, ...args))[0].r;
        const check = (label: string, ts: boolean, sql: boolean) => ts !== sql && bad.push(`${label}: backend=${ts} banco=${sql}`);
        for (const view of ["costs", "team", "progress"] as const) {
          check(`client_can ${view}`, clientCan(a, rock, view), await q(`SELECT app.client_can($1::uuid, $2) AS r`, rock, view));
        }
        check("campo", canUseField(a, rock), await q(`SELECT app.can_use_field($1::uuid) AS r`, rock));
        check("planta", canSeePlans(a, rock), await q(`SELECT app.can_see_plans($1::uuid) AS r`, rock));
        check("gerir áreas", canManageAreas(a, rock), await q(`SELECT app.can_manage_area($1::uuid) AS r`, rock));
        for (const t of [d.teams.eletrica, d.teams.bar]) {
          const s = { eventId: rock, areaId: t.areaId, teamId: t.id };
          check(`área ${t.name}`, canSeeArea(a, s), await q(`SELECT app.can_see_area($1::uuid, $2::uuid) AS r`, rock, t.areaId));
          check(`equipe ${t.name}`, canSeeTeam(a, s), await q(`SELECT app.can_see_team($1::uuid, $2::uuid, $3::uuid) AS r`, rock, t.areaId, t.id));
          check(`gerir equipes ${t.name}`, canManageTeams(a, s), await q(`SELECT app.can_manage_team($1::uuid, $2::uuid) AS r`, rock, t.areaId));
          check(`atribuir Operacional ${t.name}`, canAssignRole(a, { ...s, role: "OPERACIONAL" }),
            await q(`SELECT app.can_assign_role($1::uuid, 'OPERACIONAL'::participant_role, $2::uuid) AS r`, rock, t.areaId));
        }
        for (const o of Object.values(d.occurrences)) {
          check(`chamado ${o.title}`, canSeeOccurrence(a, o),
            await q(`SELECT app.can_see_occurrence($1::uuid, $2::uuid, $3::uuid, $4::uuid) AS r`, o.eventId, o.areaId, o.teamId, o.responsibleParticipantId));
        }
      });
      expect(bad).toEqual([]);
    });
  }
});
