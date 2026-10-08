import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { actorFor, appDb, demo, expectPgError, expectStatus, ownerDb, type Person } from "../helpers";
import { withUser } from "@/server/db/with-user";
import { databaseStorage, memoryStorage, setStorageForTests } from "@/server/storage/storage";
import { createVisit, deleteVisit, listVisits, updateVisit } from "@/modules/visits/visits.service";
import {
  MAX_VISIT_PHOTOS, MIN_VISIT_PHOTOS, addVisitPhoto, deleteVisitPhoto, getVisitReport as getVisit, setVisitStatus,
  updatePhotoCaption, updateReport, visitPhoto,
} from "@/modules/visits/report.service";

/**
 * Relatório da visita técnica: só a Pré-produção (Gerente, Pré-produtor,
 * Admin) vê; preenche quem mexe na visita (gestor, quem marcou, quem vai);
 * concluir pede 10 fotos; no máximo 40; concluída, fica travada.
 */

const db = appDb();
const owner = ownerDb();
const d = demo();
const rock = d.events.rock.id;
const created: string[] = [];

/** Uma "foto" JPEG diferente a cada chamada. */
const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...randomBytes(64)]);

async function newVisit(who: "sofia" | "marina" = "sofia") {
  const v = await createVisit(await actorFor(db, who), rock, {
    title: "Visita ao autódromo", scheduledAt: "2099-03-10T09:30", responsibleId: d.participants[who].id,
  });
  created.push(v.id);
  return v;
}

async function addPhotos(visitId: string, n: number, who: Person = "sofia") {
  const a = await actorFor(db, who);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push((await addVisitPhoto(a, visitId, jpeg(), `Foto ${i + 1}`)).id);
  return ids;
}

beforeAll(() => setStorageForTests(memoryStorage()));

afterAll(async () => {
  // Concluída não se apaga: reabre antes.
  await owner.technicalVisit.updateMany({ where: { id: { in: created } }, data: { status: "ABERTA", concludedAt: null } });
  await owner.technicalVisit.deleteMany({ where: { id: { in: created } } });
  await Promise.all([db.$disconnect(), owner.$disconnect()]);
});

describe("quem entra", () => {
  it("quem vai preenche o briefing do lugar; toda a pré-produção vê", async () => {
    const sofia = await actorFor(db, "sofia");
    const v = await newVisit("sofia");
    await updateReport(sofia, v.id, { people: "Sofia e Marina", powerText: "Quadro de 380 V atrás do palco", address: "Av. X, 1" });
    const got = await getVisit(await actorFor(db, "marina"), v.id);
    expect(got).toMatchObject({ people: "Sofia e Marina", powerText: "Quadro de 380 V atrás do palco", address: "Av. X, 1", status: "ABERTA", canEdit: true });
    // Mandar só um campo não apaga os outros.
    await updateReport(sofia, v.id, { address: null });
    expect(await getVisit(sofia, v.id)).toMatchObject({ address: null, powerText: "Quadro de 380 V atrás do palco" });
    const listed = (await listVisits(await actorFor(db, "admin"), rock)).upcoming.find((x) => x.id === v.id);
    expect(listed).toMatchObject({ status: "ABERTA", photos: 0 });
    expect(await owner.auditLog.count({ where: { entity: "technical_visit", entityId: v.id } })).toBeGreaterThanOrEqual(2);
    await expectStatus(updateReport(sofia, v.id, { powerText: "x".repeat(4001) }), 422);
  });

  it("quem não marcou, não vai e não é gestor só olha", async () => {
    const v = await newVisit("marina");
    const sofia = await actorFor(db, "sofia");
    const [photo] = await addPhotos(v.id, 1, "marina");
    expect((await getVisit(sofia, v.id)).canEdit).toBe(false);
    expect((await visitPhoto(sofia, photo!)).mimeType).toBe("image/jpeg");
    await expectStatus(updateReport(sofia, v.id, { notes: "x", powerText: "x" }), 403);
    await expectStatus(addVisitPhoto(sofia, v.id, jpeg()), 403);
    await expectStatus(updatePhotoCaption(sofia, photo!, { caption: "x" }), 403);
    await expectStatus(deleteVisitPhoto(sofia, photo!), 403);
    await expectStatus(setVisitStatus(sofia, v.id, { status: "CONCLUIDA" }), 403);
  });

  it("campo, cliente e quem é de fora não veem nem enviam nada", async () => {
    const v = await newVisit();
    const [photo] = await addPhotos(v.id, 1);
    for (const who of ["rafael", "beatriz", "joao", "carlos", "claudia", "paulo"] as const) {
      const a = await actorFor(db, who);
      await expectStatus(listVisits(a, rock), 404);
      await expectStatus(getVisit(a, v.id), 404);
      await expectStatus(updateReport(a, v.id, { powerText: "x" }), 404);
      await expectStatus(addVisitPhoto(a, v.id, jpeg()), 404);
      await expectStatus(visitPhoto(a, photo!), 404);
      await expectStatus(updatePhotoCaption(a, photo!, { caption: "x" }), 404);
      await expectStatus(deleteVisitPhoto(a, photo!), 404);
      await expectStatus(setVisitStatus(a, v.id, { status: "CONCLUIDA" }), 404);
      await expectStatus(deleteVisit(a, v.id), 404);
    }
    await expectStatus(getVisit(await actorFor(db, "sofia"), "nao-e-id"), 404);
  });
});

describe("fotos e conclusão", () => {
  it(`concluir pede ${MIN_VISIT_PHOTOS} fotos; concluída fica travada até reabrir`, async () => {
    const sofia = await actorFor(db, "sofia");
    const v = await newVisit();
    const ids = await addPhotos(v.id, MIN_VISIT_PHOTOS - 1);
    await expectStatus(setVisitStatus(sofia, v.id, { status: "CONCLUIDA" }), 422);

    // A mesma foto duas vezes não conta duas vezes.
    const same = jpeg();
    const a = await addVisitPhoto(sofia, v.id, same);
    expect(await addVisitPhoto(sofia, v.id, same)).toEqual({ id: a.id, duplicate: true });
    expect((await getVisit(sofia, v.id)).photos).toHaveLength(MIN_VISIT_PHOTOS);

    await updatePhotoCaption(sofia, ids[0]!, { caption: "Doca de carga" });
    expect((await visitPhoto(sofia, ids[0]!)).mimeType).toBe("image/jpeg");
    expect(await setVisitStatus(await actorFor(db, "marina"), v.id, { status: "CONCLUIDA" })).toEqual({ id: v.id, status: "CONCLUIDA" });
    const done = await getVisit(sofia, v.id);
    expect(done.concludedAt).not.toBeNull();
    expect(done.photos[0]).toMatchObject({ id: ids[0], caption: "Doca de carga" });

    await expectStatus(updateReport(sofia, v.id, { powerText: "x" }), 409);
    await expectStatus(updateVisit(sofia, v.id, { notes: "x" }), 409);
    await expectStatus(addVisitPhoto(sofia, v.id, jpeg()), 409);
    await expectStatus(updatePhotoCaption(sofia, ids[0]!, { caption: "x" }), 409);
    await expectStatus(deleteVisitPhoto(sofia, ids[0]!), 409);
    await expectStatus(deleteVisit(sofia, v.id), 409);

    await setVisitStatus(sofia, v.id, { status: "ABERTA" });
    expect((await getVisit(sofia, v.id)).concludedAt).toBeNull();
    await deleteVisitPhoto(sofia, ids[0]!);
    expect((await getVisit(sofia, v.id)).photos).toHaveLength(MIN_VISIT_PHOTOS - 1);
    await expectStatus(setVisitStatus(sofia, v.id, { status: "CONCLUIDA" }), 422);
  });

  it(`no máximo ${MAX_VISIT_PHOTOS} fotos`, async () => {
    const v = await newVisit("marina");
    await addPhotos(v.id, MAX_VISIT_PHOTOS, "marina");
    await expectStatus(addVisitPhoto(await actorFor(db, "marina"), v.id, jpeg()), 422);
    expect(await owner.technicalVisitPhoto.count({ where: { visitId: v.id } })).toBe(MAX_VISIT_PHOTOS);
  });

  it("só aceita imagem", async () => {
    const v = await newVisit();
    await expectStatus(addVisitPhoto(await actorFor(db, "sofia"), v.id, new TextEncoder().encode("não é foto")), 422);
    await expectStatus(addVisitPhoto(await actorFor(db, "sofia"), v.id, new Uint8Array()), 422);
  });

  it("apagar a visita aberta leva as fotos", async () => {
    const v = await newVisit();
    await addPhotos(v.id, 2);
    await deleteVisit(await actorFor(db, "sofia"), v.id);
    expect(await owner.technicalVisitPhoto.count({ where: { visitId: v.id } })).toBe(0);
  });
});

describe("no banco", () => {
  const as = <T>(p: Person, fn: Parameters<typeof withUser<T>>[2]) => withUser(db, d.users[p]!, fn);

  it("a RLS esconde a visita de quem não é da pré-produção e os gatilhos repetem as regras", async () => {
    const v = await newVisit();
    await addPhotos(v.id, 3);
    for (const who of ["rafael", "joao", "claudia", "paulo"] as const) {
      expect(await as(who, (tx) => tx.technicalVisit.count({ where: { id: v.id } }))).toBe(0);
      expect(await as(who, (tx) => tx.technicalVisitPhoto.count({ where: { visitId: v.id } }))).toBe(0);
      expect((await as(who, (tx) => tx.technicalVisit.updateMany({ where: { id: v.id }, data: { notes: "x" } }))).count).toBe(0);
    }
    // Inserir direto, no nome de outra pessoa ou sem ser da pré-produção.
    // Concluir sem 10 fotos, trocar o autor, mexer na foto.
    await expectPgError(as("sofia", (tx) => tx.technicalVisit.update({ where: { id: v.id }, data: { status: "CONCLUIDA", concludedAt: new Date() } })), "23514");
    await expectPgError(as("marina", (tx) => tx.technicalVisit.update({ where: { id: v.id }, data: { createdById: d.users.marina! } })), "42501");
    const photo = await owner.technicalVisitPhoto.findFirstOrThrow({ where: { visitId: v.id } });
    await expectPgError(as("sofia", (tx) => tx.technicalVisitPhoto.update({ where: { id: photo.id }, data: { storageKey: "outra" } })), "42501");
    // Foto no nome de outra pessoa; e quem só olha a visita da Marina não envia.
    const marinas = await newVisit("marina");
    await expectPgError(
      as("sofia", (tx) => tx.technicalVisitPhoto.create({
        data: { eventId: rock, visitId: marinas.id, storageKey: `y/${photo.id}`, mimeType: "image/jpeg", sizeBytes: 1, sha256: "y", uploadedById: d.users.sofia! },
      })),
      "42501",
    );
    await expectPgError(
      as("marina", (tx) => tx.technicalVisitPhoto.create({
        data: { eventId: rock, visitId: v.id, storageKey: `x/${photo.id}`, mimeType: "image/jpeg", sizeBytes: 1, sha256: "x", uploadedById: d.users.sofia! },
      })),
      "42501",
    );
  });

  it("os bytes guardados no banco só abrem para a pré-produção", async () => {
    setStorageForTests(databaseStorage());
    try {
      const v = await newVisit();
      const [id] = await addPhotos(v.id, 1);
      const photo = await owner.technicalVisitPhoto.findUniqueOrThrow({ where: { id: id! } });
      const read = (who: Person) => as(who, (tx) => tx.$queryRaw<unknown[]>`SELECT key FROM stored_files WHERE key = ${photo.storageKey}`);
      expect(await read("sofia")).toHaveLength(1);
      expect(await read("marina")).toHaveLength(1);
      expect(await read("rafael")).toHaveLength(0);
      expect(await read("joao")).toHaveLength(0);
      expect((await visitPhoto(await actorFor(db, "sofia"), id!)).body?.length).toBeGreaterThan(0);
    } finally {
      setStorageForTests(memoryStorage());
    }
  });
});
