import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { actorFor, appDb, demo, expectPgError, expectStatus, ownerDb, type Person } from "../helpers";
import { withUser, type Tx } from "@/server/db/with-user";
import { databaseStorage, memoryStorage, setStorageForTests } from "@/server/storage/storage";
import {
  addDocument, deleteDocument, documentFile, fieldDocumentCount, listDocuments, listFieldDocuments, updateDocument,
} from "@/modules/documents/documents.service";
import { sniffDocument } from "@/modules/documents/file";

/**
 * Central de documentos: a Pré-produção envia e vê; o gestor libera para o
 * campo, que só lê; apaga quem enviou ou o gestor.
 */

const db = appDb();
const owner = ownerDb();
const d = demo();
const rock = d.events.rock.id;
const as = <T>(p: Person, fn: (tx: Tx) => Promise<T>) => withUser(db, d.users[p]!, fn);

/** Um "PDF" diferente a cada chamada. */
const pdf = (name = "planta.pdf") => ({ bytes: new Uint8Array([...Buffer.from("%PDF-1.7\n"), ...randomBytes(64)]), name });
const docx = () => ({ bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...randomBytes(64)]), name: "contrato.docx" });
const clean = () => owner.eventDocument.deleteMany({ where: { eventId: rock } });

beforeAll(async () => {
  setStorageForTests(memoryStorage());
  await clean();
});
afterAll(async () => {
  await clean();
  await Promise.all([db.$disconnect(), owner.$disconnect()]);
});

describe("arquivos aceitos", () => {
  it("PDF, imagem e Office pelos bytes; o resto não", () => {
    expect(sniffDocument(pdf().bytes, "x.pdf")?.mime).toBe("application/pdf");
    expect(sniffDocument(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...randomBytes(64)]), "foto.jpg")?.inline).toBe(true);
    expect(sniffDocument(docx().bytes, "contrato.docx")).toMatchObject({ ext: "docx", inline: false });
    expect(sniffDocument(docx().bytes, "apresentacao.pptx")?.ext).toBe("pptx");
    expect(sniffDocument(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]), "antigo.xls")?.ext).toBe("xls");
    expect(sniffDocument(docx().bytes, "virus.exe")).toBeNull();
    expect(sniffDocument(new Uint8Array(Buffer.from("<html><script>")), "pagina.pdf")).toBeNull();
  });
});

describe("documentos", () => {
  let planta = "";
  let contrato = "";

  it("a Pré-produtora envia; o nome vem do arquivo; o mesmo arquivo não entra duas vezes", async () => {
    const sofia = await actorFor(db, "sofia");
    const file = pdf("Planta baixa v3.pdf");
    planta = (await addDocument(sofia, rock, { category: "PLANTA" }, file)).id;
    contrato = (await addDocument(sofia, rock, { category: "CONTRATO", title: "Contrato do palco" }, docx())).id;
    await expectStatus(addDocument(sofia, rock, { category: "OUTRO" }, file), 409);
    const list = await listDocuments(await actorFor(db, "marina"), rock);
    expect(list.documents.map((x) => x.title).sort()).toEqual(["Contrato do palco", "Planta baixa v3"]);
    expect(list.documents.find((x) => x.id === planta)).toMatchObject({ uploadedBy: d.participants.sofia.name, visibleToField: false });
    expect(list.canRelease).toBe(true);
    expect((await listDocuments(sofia, rock)).canRelease).toBe(false);
    expect(await owner.auditLog.count({ where: { entity: "event_document", entityId: planta } })).toBe(1);
  });

  it("recusa arquivo errado e categoria que não existe", async () => {
    const sofia = await actorFor(db, "sofia");
    await expectStatus(addDocument(sofia, rock, { category: "PLANTA" }, { bytes: new Uint8Array(Buffer.from("MZ...")), name: "a.exe" }), 422);
    await expectStatus(addDocument(sofia, rock, { category: "PLANTA" }, { bytes: new Uint8Array(), name: "a.pdf" }), 422);
    await expectStatus(addDocument(sofia, rock, { category: "FOTO" }, pdf()), 422);
    await expectStatus(addDocument(sofia, rock, {}, pdf()), 422);
    await expectStatus(addDocument(sofia, rock, { category: "PLANTA" }, { bytes: new Uint8Array(11 * 1024 * 1024), name: "grande.pdf" }), 422);
  });

  it("antes de liberar, o campo não vê nada", async () => {
    for (const who of ["rafael", "joao"] as const) {
      expect(await listFieldDocuments(await actorFor(db, who), rock)).toEqual([]);
      await expectStatus(documentFile(await actorFor(db, who), planta), 404);
    }
  });

  it("só o gestor libera para o campo; aí Head e Operacional leem, mas não mexem", async () => {
    const sofia = await actorFor(db, "sofia");
    await expectStatus(updateDocument(sofia, planta, { visibleToField: true }), 403);
    await expectStatus(addDocument(sofia, rock, { category: "PLANTA", visibleToField: true }, pdf()), 403);
    await updateDocument(await actorFor(db, "marina"), planta, { visibleToField: true });

    for (const who of ["rafael", "joao"] as const) {
      const a = await actorFor(db, who);
      expect((await listFieldDocuments(a, rock)).map((x) => x.id)).toEqual([planta]);
      expect(await fieldDocumentCount(a, rock)).toBe(1);
      expect((await documentFile(a, planta)).body?.length).toBeGreaterThan(0);
      await expectStatus(documentFile(a, contrato), 404);
      await expectStatus(updateDocument(a, planta, { title: "x" }), 403);
      await expectStatus(deleteDocument(a, planta), 403);
      await expectStatus(listDocuments(a, rock), 404);
    }
    // O cliente, a Pré-produtora no campo e quem é de fora: nada.
    await expectStatus(listFieldDocuments(await actorFor(db, "claudia"), rock), 404);
    await expectStatus(listFieldDocuments(await actorFor(db, "sofia"), rock), 404);
    await expectStatus(documentFile(await actorFor(db, "claudia"), planta), 404);
    await expectStatus(documentFile(await actorFor(db, "paulo"), planta), 404);
  });

  it("a Pré-produtora renomeia e troca a categoria; apaga o que enviou; o gestor apaga qualquer um", async () => {
    const sofia = await actorFor(db, "sofia");
    await updateDocument(sofia, contrato, { title: "Contrato assinado", category: "PEDIDO" });
    expect((await listDocuments(sofia, rock)).documents.find((x) => x.id === contrato)).toMatchObject({ title: "Contrato assinado", category: "PEDIDO" });
    await expectStatus(updateDocument(sofia, contrato, { title: " " }), 422);
    const mine = await addDocument(await actorFor(db, "marina"), rock, { category: "OUTRO" }, pdf());
    await expectStatus(deleteDocument(sofia, mine.id), 403);
    await deleteDocument(await actorFor(db, "marina"), mine.id);
    await deleteDocument(sofia, contrato);
    expect((await listDocuments(sofia, rock)).documents.map((x) => x.id)).toEqual([planta]);
  });
});

describe("no banco", () => {
  it("a RLS e o gatilho seguram cada regra", async () => {
    const sofiaUser = d.users.sofia!;
    const base = { eventId: rock, category: "OUTRO" as const, title: "x", fileName: "x.pdf", mimeType: "application/pdf", sizeBytes: 1 };
    const row = (n: number, uploadedById: string, visibleToField = false) =>
      ({ ...base, sha256: String(n).repeat(64).slice(0, 64), storageKey: `t/${n}-${Date.now()}`, uploadedById, visibleToField });
    // Campo não grava; ninguém grava em nome de outro; Pré-produtora não libera.
    await expectPgError(as("joao", (tx) => tx.eventDocument.create({ data: row(1, d.users.joao!) })), "42501");
    await expectPgError(as("sofia", (tx) => tx.eventDocument.create({ data: row(2, d.users.marina!) })), "42501");
    await expectPgError(as("sofia", (tx) => tx.eventDocument.create({ data: row(3, sofiaUser, true) })), "42501");
    const created = await as("sofia", (tx) => tx.eventDocument.create({ data: row(4, sofiaUser) }));
    await expectPgError(as("sofia", (tx) => tx.eventDocument.update({ where: { id: created.id }, data: { visibleToField: true } })), "42501");
    await expectPgError(as("sofia", (tx) => tx.eventDocument.update({ where: { id: created.id }, data: { storageKey: "outro" } })), "23514");
    // Não liberado: o campo não enxerga; o Head não apaga nem o liberado.
    expect(await as("rafael", (tx) => tx.eventDocument.count({ where: { id: created.id } }))).toBe(0);
    expect(await as("rafael", (tx) => tx.eventDocument.count({ where: { eventId: rock, visibleToField: true } }))).toBe(1);
    expect((await as("rafael", (tx) => tx.eventDocument.deleteMany({ where: { eventId: rock } }))).count).toBe(0);
    expect((await as("claudia", (tx) => tx.eventDocument.count({ where: { eventId: rock } })))).toBe(0);
    await as("sofia", (tx) => tx.eventDocument.delete({ where: { id: created.id } }));
  });

  it("os bytes guardados no banco só abrem para quem vê o documento, e saem junto ao apagar", async () => {
    setStorageForTests(databaseStorage());
    try {
      const sofia = await actorFor(db, "sofia");
      const { id } = await addDocument(sofia, rock, { category: "MEMORIAL" }, pdf("memorial.pdf"));
      const doc = await owner.eventDocument.findUniqueOrThrow({ where: { id } });
      const read = (who: Person) => as(who, (tx) => tx.$queryRaw<unknown[]>`SELECT key FROM stored_files WHERE key = ${doc.storageKey}`);
      expect(await read("sofia")).toHaveLength(1);
      expect(await read("joao")).toHaveLength(0);
      await updateDocument(await actorFor(db, "marina"), id, { visibleToField: true });
      expect(await read("joao")).toHaveLength(1);
      expect((await documentFile(await actorFor(db, "joao"), id)).body?.length).toBeGreaterThan(0);
      await deleteDocument(sofia, id);
      expect(await owner.$queryRaw<unknown[]>`SELECT key FROM stored_files WHERE key = ${doc.storageKey}`).toHaveLength(0);
    } finally {
      setStorageForTests(memoryStorage());
    }
  });
});
