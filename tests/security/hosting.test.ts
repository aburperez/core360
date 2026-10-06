import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectPgError, expectStatus, ownerDb, workerDb } from "../helpers";
import { addPhoto, photoBytes } from "@/modules/attachments/attachments.service";
import { databaseStorage, setStorageForTests } from "@/server/storage/storage";
import { ownerDatabaseUrl, rolePassword, roleDatabaseUrl } from "@/server/db/urls";
import { seedTraining, TRAINING_EVENT } from "../../prisma/training-data";

/**
 * Ambiente de teste na Vercel + Neon: fotos no banco, endereços dos papéis
 * montados a partir de um só DATABASE_URL e o evento de treino.
 */

const app = appDb();
const owner = ownerDb();
const worker = workerDb();
const d = demo();
beforeAll(() => setStorageForTests(databaseStorage()));
afterAll(() => Promise.all([app.$disconnect(), owner.$disconnect(), worker.$disconnect()]));

const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 64 }, () => Math.floor(Math.random() * 256))]);

describe("fotos guardadas no banco", () => {
  it("quem vê o chamado vê a foto; quem não vê, nem pelo banco", async () => {
    const ana = await actorFor(app, "ana");
    const bytes = jpeg();
    const photo = await addPhoto(ana, d.occurrences.painelCenografia.id, { bytes });

    const got = await photoBytes(await actorFor(app, "rafael"), photo.id);
    expect(Buffer.from(got!.body).equals(Buffer.from(bytes))).toBe(true);

    const joao = await actorFor(app, "joao");
    await expectStatus(photoBytes(joao, photo.id), 404);
    // Mesmo indo direto na tabela, a RLS não entrega a foto de outra equipe.
    const rows = await joao.run((tx) => tx.$queryRaw<unknown[]>`SELECT key FROM stored_files WHERE key = ${photo.storageKey}`);
    expect(rows).toEqual([]);
    // Despacho de avisos não lê fotos.
    await expectPgError(worker.$queryRaw`SELECT 1 FROM stored_files LIMIT 1`, "42501");
  });

  it("foto e registro vão juntos: se o registro falha, a foto não fica", async () => {
    const before = await owner.storedFile.count();
    const joao = await actorFor(app, "joao");
    await expectStatus(addPhoto(joao, d.occurrences.painelCenografia.id, { bytes: jpeg() }), 404);
    expect(await owner.storedFile.count()).toBe(before);
  });
});

describe("endereços do banco na hospedagem", () => {
  it("monta o endereço de cada papel a partir do DATABASE_URL, com senha própria", () => {
    const saved = { ...process.env };
    try {
      process.env.DATABASE_URL = "postgresql://dono:x@ep-teste-pooler.neon.tech/neondb?sslmode=require";
      process.env.DB_ROLES_SECRET = "z".repeat(40);
      delete process.env.APP_DATABASE_URL;
      const url = new URL(roleDatabaseUrl("app")!);
      expect(url.username).toBe("core_app");
      expect(url.password).toBe(rolePassword("app"));
      expect(url.host).toBe("ep-teste-pooler.neon.tech");
      expect(url.searchParams.get("sslmode")).toBe("require");
      expect(rolePassword("app")).not.toBe(rolePassword("worker"));
      // Endereço explícito continua valendo.
      process.env.APP_DATABASE_URL = "postgresql://outro@h/db";
      expect(roleDatabaseUrl("app")).toBe("postgresql://outro@h/db");
    } finally {
      process.env = saved;
    }
  });

  it("aceita as variáveis com outro prefixo (DATABASE1_URL) que a Vercel cria", () => {
    const saved = { ...process.env };
    try {
      delete process.env.DATABASE_URL;
      delete process.env.DATABASE_URL_UNPOOLED;
      delete process.env.APP_DATABASE_URL;
      process.env.DB_ROLES_SECRET = "z".repeat(40);
      process.env.DATABASE1_URL = "postgresql://dono:x@ep-um-pooler.neon.tech/neondb?sslmode=require";
      process.env.DATABASE1_URL_UNPOOLED = "postgresql://dono:x@ep-um.neon.tech/neondb?sslmode=require";
      expect(new URL(roleDatabaseUrl("app")!).host).toBe("ep-um-pooler.neon.tech");
      expect(ownerDatabaseUrl()).toBe(process.env.DATABASE1_URL_UNPOOLED);
      // Com DATABASE_URL presente, ele vale.
      process.env.DATABASE_URL = "postgresql://dono:x@ep-zero.neon.tech/neondb";
      expect(new URL(roleDatabaseUrl("app")!).host).toBe("ep-zero.neon.tech");
      expect(ownerDatabaseUrl()).toBe(process.env.DATABASE_URL);
    } finally {
      process.env = saved;
    }
  });
});

describe("evento de treino", () => {
  it("cria o Admin e o evento uma vez; rodar de novo não duplica nem troca a senha", async () => {
    const admin = { email: "Abu.Teste@Agencia.dev", password: "senha-forte-123", name: "Abu" };
    expect(await seedTraining(owner, admin)).toEqual({ adminCreated: true, eventCreated: true });
    const account = await owner.account.findFirstOrThrow({ where: { user: { email: "abu.teste@agencia.dev" } } });
    expect(await seedTraining(owner, { ...admin, password: "outra-senha-456" })).toEqual({ adminCreated: false, eventCreated: false });
    expect((await owner.account.findUniqueOrThrow({ where: { id: account.id } })).password).toBe(account.password);

    const event = await owner.event.findFirstOrThrow({ where: { name: TRAINING_EVENT }, include: { areas: true, teams: true } });
    expect(event.areas.map((a) => a.name).sort()).toEqual(["Infraestrutura", "Palco"]);
    expect(event.teams.map((t) => t.name).sort()).toEqual(["Cenografia", "Elétrica", "Limpeza"]);
    expect(await owner.occurrence.count({ where: { eventId: event.id } })).toBe(3);
    // Tipos de atendimento de exemplo (Pré-produção), sem duplicar a cada deploy.
    expect(await owner.serviceType.count({ where: { eventId: event.id } })).toBe(6);
    await seedTraining(owner, admin);
    expect(await owner.serviceType.count({ where: { eventId: event.id } })).toBe(6);
    expect(await owner.user.findUniqueOrThrow({ where: { email: "abu.teste@agencia.dev" } })).toMatchObject({ isAdmin: true, active: true });
  });
});
