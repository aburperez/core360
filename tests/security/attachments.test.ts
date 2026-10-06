import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectStatus } from "../helpers";
import { addPhoto, photoUrl } from "@/modules/attachments/attachments.service";
import { memoryStorage, setStorageForTests } from "@/server/storage/storage";

const db = appDb();
const d = demo();
const storage = memoryStorage();
beforeAll(() => setStorageForTests(storage));
afterAll(() => db.$disconnect());

// Cabeçalho mínimo de JPEG + bytes aleatórios para cada teste ter hash próprio.
const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 64 }, () => Math.floor(Math.random() * 256))]);

describe("evidências fotográficas", () => {
  it("Operacional anexa foto ao chamado da própria equipe; reenviar não duplica", async () => {
    const joao = await actorFor(db, "joao");
    const bytes = jpeg();
    const a = await addPhoto(joao, d.occurrences.quadroEletrico.id, { bytes });
    expect(a).toMatchObject({ mimeType: "image/jpeg", eventId: d.events.rock.id, uploadedById: d.users.joao });
    expect(storage.objects.has(a.storageKey)).toBe(true);
    expect(a.storageKey).toContain(d.occurrences.quadroEletrico.id);

    const again = await addPhoto(joao, d.occurrences.quadroEletrico.id, { bytes });
    expect(again.id).toBe(a.id);

    expect(await photoUrl(joao, a.id)).toContain(a.storageKey);
  });

  it("recusa arquivo que não é foto, mesmo se o nome/tipo disser que é", async () => {
    const joao = await actorFor(db, "joao");
    const pdf = new TextEncoder().encode("%PDF-1.7 conteúdo qualquer......");
    await expectStatus(addPhoto(joao, d.occurrences.quadroEletrico.id, { bytes: pdf }), 422);
    await expectStatus(addPhoto(joao, d.occurrences.quadroEletrico.id, { bytes: new Uint8Array() }), 422);
  });

  it("não anexa nem vê foto de ocorrência fora do escopo", async () => {
    const joao = await actorFor(db, "joao");
    await expectStatus(addPhoto(joao, d.occurrences.painelCenografia.id, { bytes: jpeg() }), 404);

    const ana = await actorFor(db, "ana");
    const photo = await addPhoto(ana, d.occurrences.painelCenografia.id, { bytes: jpeg(), kind: "CONCLUSAO" });

    await expectStatus(photoUrl(joao, photo.id), 404);
    await expectStatus(photoUrl(await actorFor(db, "beatriz"), photo.id), 404);
    await expectStatus(photoUrl(await actorFor(db, "claudia"), photo.id), 404);
    await expectStatus(photoUrl(await actorFor(db, "paulo"), photo.id), 404);
    // Head da área e gerente do evento veem.
    expect(await photoUrl(await actorFor(db, "rafael"), photo.id)).toBeTruthy();
    expect(await photoUrl(await actorFor(db, "marina"), photo.id)).toBeTruthy();
  });
});
