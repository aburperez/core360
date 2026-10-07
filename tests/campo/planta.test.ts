import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectPgError, expectStatus, type Person } from "../helpers";
import { withUser, type Tx } from "@/server/db/with-user";
import { memoryStorage, setStorageForTests } from "@/server/storage/storage";
import {
  addPointPhoto,
  createPoint,
  deletePlan,
  deletePoint,
  getPlanBoard,
  planImage,
  plansSummary,
  pointPhoto,
  pointSituation,
  renamePlan,
  setPointStatus,
  updatePoint,
  uploadPlan,
} from "@/modules/floorplans/floorplans.service";
import { setClientView } from "@/modules/participants/client-views.service";

/**
 * Planta do evento (Gestão de campo): Marina (Gerente) envia a planta e marca
 * etapas; Rafael (Head de Infra) marca só na área dele; a equipe da etapa
 * inicia e conclui. Todos do campo veem, e o Cliente com o andamento
 * liberado (só olhando); Pré-produtor e outro evento não.
 * Pelo serviço e direto no banco (RLS e gatilhos seguram sozinhos).
 */

const db = appDb();
const d = demo();
beforeAll(() => setStorageForTests(memoryStorage()));
// A Cláudia (Cliente) volta a não ver nada, como os outros testes esperam.
afterAll(async () => {
  await setClientView(await actorFor(db, "marina"), d.participants.claudia.id, { progress: false });
  await db.$disconnect();
});

const rock = d.events.rock.id;
const as = <T>(p: Person, fn: (tx: Tx) => Promise<T>) => withUser(db, d.users[p]!, fn);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1]);

describe("situação da etapa", () => {
  const now = new Date("2027-04-10T12:00:00Z");
  const before = new Date("2027-04-10T11:00:00Z");
  const after = new Date("2027-04-10T13:00:00Z");
  it("atrasa pelo horário previsto", () => {
    expect(pointSituation({ status: "NAO_INICIADO", startsAt: after, endsAt: null }, now)).toBe("NAO_INICIADO");
    expect(pointSituation({ status: "NAO_INICIADO", startsAt: before, endsAt: after }, now)).toBe("ATRASADO");
    expect(pointSituation({ status: "EM_ANDAMENTO", startsAt: before, endsAt: after }, now)).toBe("EM_ANDAMENTO");
    expect(pointSituation({ status: "EM_ANDAMENTO", startsAt: null, endsAt: before }, now)).toBe("ATRASADO");
    expect(pointSituation({ status: "CONCLUIDO", startsAt: null, endsAt: before }, now)).toBe("CONCLUIDO");
    expect(pointSituation({ status: "NAO_INICIADO", startsAt: null, endsAt: null }, now)).toBe("NAO_INICIADO");
  });
});

describe("Planta do começo ao fim", () => {
  let planId = "";
  let geral = "";
  let eletrica = "";
  let bar = "";

  it("só o gerente envia a planta; o campo vê, a pré-produção e outro evento não", async () => {
    const marina = await actorFor(db, "marina");
    await expectStatus(uploadPlan(await actorFor(db, "rafael"), rock, { name: "Geral" }, PNG), 403);
    await expectStatus(uploadPlan(await actorFor(db, "joao"), rock, { name: "Geral" }, PNG), 403);
    await expectStatus(uploadPlan(marina, rock, { name: "Geral" }, new TextEncoder().encode("%PDF-1.4 não convertido")), 422);
    await expectStatus(uploadPlan(marina, rock, { name: "" }, PNG), 422);

    const plan = await uploadPlan(marina, rock, { name: "Planta geral" }, PNG);
    planId = plan.id;
    await renamePlan(marina, planId, { name: "Geral" });

    // O Cliente só vê a planta com o andamento liberado pelo Gerente.
    await expectStatus(getPlanBoard(await actorFor(db, "claudia"), rock), 404);
    await expectStatus(planImage(await actorFor(db, "claudia"), planId), 404);
    await setClientView(marina, d.participants.claudia.id, { progress: true });

    for (const p of ["rafael", "joao", "claudia"] as const) {
      const board = await getPlanBoard(await actorFor(db, p), rock);
      expect(board.plans.map((x) => x.name)).toEqual(["Geral"]);
      expect((await planImage(await actorFor(db, p), planId)).body).toEqual(PNG);
    }
    await expectStatus(getPlanBoard(await actorFor(db, "sofia"), rock), 404);
    await expectStatus(planImage(await actorFor(db, "sofia"), planId), 404);
    await expectStatus(getPlanBoard(await actorFor(db, "paulo"), rock), 404);
    await expectStatus(planImage(await actorFor(db, "paulo"), planId), 404);
  });

  it("o gerente marca em qualquer área; o head só na dele", async () => {
    const marina = await actorFor(db, "marina");
    const rafael = await actorFor(db, "rafael");
    geral = (await createPoint(marina, planId, { name: "Credenciamento", kind: "MONTAGEM", x: 10, y: 20 })).id;
    bar = (await createPoint(marina, planId, {
      name: "Bar central", kind: "MONTAGEM", x: 60, y: 40, teamId: d.teams.bar.id, startsAt: "2020-01-01T08:00", endsAt: "2020-01-01T10:00",
    })).id;

    // Rafael sem escolher área marca na dele; a equipe de outra área é recusada.
    eletrica = (await createPoint(rafael, planId, {
      name: "Gerador palco", kind: "MONTAGEM", x: 30, y: 70, teamId: d.teams.eletrica.id, responsibleId: d.participants.joao.id,
    })).id;
    const own = await createPoint(rafael, planId, { name: "Rack de luz", kind: "FINALIZACAO", x: 31, y: 71 });
    await expectStatus(createPoint(rafael, planId, { name: "Bar 2", kind: "MONTAGEM", x: 1, y: 1, areaId: d.areas.ab.id }), 403);
    await expectStatus(createPoint(rafael, planId, { name: "X", kind: "MONTAGEM", x: 1, y: 1, teamId: d.teams.bar.id }), 422);
    await expectStatus(createPoint(await actorFor(db, "joao"), planId, { name: "X", kind: "MONTAGEM", x: 1, y: 1 }), 403);
    await expectStatus(createPoint(await actorFor(db, "claudia"), planId, { name: "X", kind: "MONTAGEM", x: 1, y: 1 }), 403);
    await expectStatus(createPoint(marina, planId, { name: "X", kind: "MONTAGEM", x: 120, y: 1 }), 422);
    await expectStatus(createPoint(marina, planId, { name: "X", kind: "MONTAGEM", x: 1, y: 1, responsibleId: d.participants.claudia.id }), 422);
    await expectStatus(createPoint(marina, planId, { name: "X", kind: "MONTAGEM", x: 1, y: 1, startsAt: "2027-04-10T10:00", endsAt: "2027-04-10T09:00" }), 422);

    const board = await getPlanBoard(rafael, rock, planId);
    expect(board.points.find((p) => p.id === own.id)).toMatchObject({ areaName: "Infraestrutura", canEdit: true });
    expect(board.points.find((p) => p.id === geral)).toMatchObject({ canEdit: false, canWork: false });
    expect(board.lockedAreaId).toBe(d.areas.infra.id);
    expect(board.options?.areas.map((a) => a.name)).toEqual(["Infraestrutura"]);

    // Head não mexe na etapa geral nem leva a dele para outra área.
    await expectStatus(updatePoint(rafael, geral, { name: "Outro" }), 403);
    await expectStatus(updatePoint(rafael, own.id, { areaId: d.areas.ab.id }), 403);
    await expectStatus(updatePoint(await actorFor(db, "beatriz"), eletrica, { x: 50 }), 403);
    await updatePoint(rafael, own.id, { x: 35, y: 72, startsAt: "2027-04-10T09:00" });
    await deletePoint(rafael, own.id);
    await expectStatus(deletePoint(rafael, geral), 403);
  });

  it("a equipe da etapa inicia e conclui; outras equipes e o cliente só veem", async () => {
    const carlos = await actorFor(db, "carlos");
    await setPointStatus(carlos, eletrica, { status: "EM_ANDAMENTO" });
    await setPointStatus(await actorFor(db, "joao"), eletrica, { status: "CONCLUIDO", note: "Gerador ligado" });
    await expectStatus(setPointStatus(await actorFor(db, "ana"), eletrica, { status: "NAO_INICIADO" }), 403);
    await expectStatus(setPointStatus(await actorFor(db, "claudia"), eletrica, { status: "NAO_INICIADO" }), 403);
    await expectStatus(setPointStatus(carlos, bar, { status: "EM_ANDAMENTO" }), 403);
    await expectStatus(setPointStatus(carlos, geral, { status: "EM_ANDAMENTO" }), 403);
    await setPointStatus(await actorFor(db, "beatriz"), bar, { status: "EM_ANDAMENTO" });

    const board = await getPlanBoard(await actorFor(db, "joao"), rock);
    const mine = board.points.find((p) => p.id === eletrica)!;
    expect(mine).toMatchObject({ status: "CONCLUIDO", note: "Gerador ligado", teamName: "Elétrica", responsibleName: "João", canWork: true, canEdit: false });
    expect(mine.startedAt).not.toBeNull();
    // Etapa de outra área: aparece na planta, mas sem os nomes que ele não pode ver.
    expect(board.points.find((p) => p.id === bar)).toMatchObject({ name: "Bar central", areaName: null, teamName: null, canWork: false });
    expect(board.canMark).toBe(false);

    const photo = await addPointPhoto(await actorFor(db, "joao"), eletrica, JPG);
    expect((await pointPhoto(await actorFor(db, "claudia"), photo.id)).body).toEqual(JPG);
    await expectStatus(pointPhoto(await actorFor(db, "sofia"), photo.id), 404);
    await expectStatus(addPointPhoto(await actorFor(db, "ana"), eletrica, JPG), 403);

    const sum = await plansSummary(await actorFor(db, "marina"), rock);
    expect(sum).toMatchObject({ total: 3, done: 1, doing: 1, late: 1 });
    expect(sum!.lateRows.map((r) => r.name)).toEqual(["Bar central"]);
    expect(await plansSummary(await actorFor(db, "sofia"), rock)).toBeNull();
  });

  it("no banco, direto: RLS e gatilhos seguram quem passa por fora do serviço", async () => {
    // João não muda o nome nem o lugar da etapa da equipe dele.
    await expectPgError(as("joao", (tx) => tx.planPoint.update({ where: { id: eletrica }, data: { name: "Outro" } })), "42501");
    await expectPgError(as("joao", (tx) => tx.planPoint.update({ where: { id: eletrica }, data: { x: 1 } })), "42501");
    // Nem põe a conclusão no nome de outra pessoa.
    await expectPgError(
      as("joao", (tx) => tx.planPoint.update({ where: { id: eletrica }, data: { finishedById: d.users.carlos!, finishedAt: new Date() } })),
      "42501",
    );
    // Etapa de outra equipe: a linha nem aparece para ele mudar.
    const r = await as("joao", (tx) => tx.planPoint.updateMany({ where: { id: bar }, data: { status: "CONCLUIDO", finishedAt: new Date() } }));
    expect(r.count).toBe(0);
    await expectPgError(
      as("joao", (tx) => tx.planPoint.create({ data: { eventId: rock, planId, x: 1, y: 1, name: "X", kind: "MONTAGEM", createdById: d.users.joao! } })),
      "42501",
    );
    await expectPgError(
      as("rafael", (tx) => tx.planPoint.update({ where: { id: eletrica }, data: { areaId: d.areas.ab.id, teamId: null } })),
      "42501",
    );
    await expectPgError(as("marina", (tx) => tx.planPoint.update({ where: { id: geral }, data: { responsibleId: d.participants.claudia.id } })), "23514");
    await expectPgError(as("marina", (tx) => tx.planPoint.update({ where: { id: geral }, data: { status: "CONCLUIDO" } })), "23514");
    expect((await as("rafael", (tx) => tx.floorPlan.updateMany({ where: { id: planId }, data: { name: "X" } }))).count).toBe(0);
    expect(await as("sofia", (tx) => tx.planPoint.count({ where: { eventId: rock } }))).toBe(0);
    expect(await as("sofia", (tx) => tx.floorPlan.count({ where: { eventId: rock } }))).toBe(0);
    expect(await as("paulo", (tx) => tx.planPoint.count({ where: { eventId: rock } }))).toBe(0);
    expect(await as("claudia", (tx) => tx.planPoint.count({ where: { eventId: rock } }))).toBe(3);
  });

  it("apagar a planta leva as etapas junto (só o gerente)", async () => {
    await expectStatus(deletePlan(await actorFor(db, "rafael"), planId), 403);
    await deletePlan(await actorFor(db, "marina"), planId);
    expect(await as("marina", (tx) => tx.planPoint.count({ where: { planId } }))).toBe(0);
    expect(await plansSummary(await actorFor(db, "marina"), rock)).toBeNull();
  });
});
