import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectStatus, ownerDb, type Person } from "../helpers";
import { withUser, type Tx } from "@/server/db/with-user";
import { memoryStorage, setStorageForTests } from "@/server/storage/storage";
import { createEvent } from "@/modules/events/events.service";
import { addSupplierQuote, createQuote, getQuote, MAX_AI_READS_PER_HOUR, readQuoteWithAi, setQuoteState } from "@/modules/quotes/quotes.service";
import { createSupplier, setSupplierArchived } from "@/modules/suppliers/suppliers.service";
import { anthropicQuoteReader, QUOTE_READER_MODEL, type QuoteReader, type QuoteReading } from "@/modules/quotes/quote-reader";

/**
 * Leitura do orçamento pela IA (fase 3B). A IA só lê: nada é salvo até quem
 * anexou conferir e confirmar (o addSupplierQuote normal). Só a Pré-produção
 * usa, só PDF e foto, com limite por hora, e a leitura fica no histórico. A
 * chamada à Anthropic é trocada por uma leitura de mentira.
 */

const db = appDb();
const owner = ownerDb();
const d = demo();
const as = <T>(p: Person, fn: (tx: Tx) => Promise<T>) => withUser(db, d.users[p]!, fn);

const PDF = { bytes: new TextEncoder().encode("%PDF-1.4\n% orçamento\n"), name: "orcamento-luz.pdf" };
const XLSX = { bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0]), name: "orcamento.xlsx" };
const HEIC = { bytes: new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode("ftypheic"), 0, 0, 0, 0]), name: "IMG_0001.HEIC" };
const CNPJ = { luz: "73.159.024/0001-61", arquivado: "84.620.317/0001-10", novo: "91.347.865/0001-84" };

const reading = (over: Partial<QuoteReading> = {}): QuoteReading => ({
  isQuote: true, cnpj: CNPJ.novo, companyName: "  Luz & Cia   Iluminação Ltda ", tradeName: "Luz & Cia", contactName: "Carla Mendes",
  phone: "(11) 3456-7890", email: "carla@luzecia.dev", totalValue: 18_450.505, paymentTerms: "50% na aprovação, 50% em 30 dias",
  notes: "Validade: 15 dias.\nInclui montagem e operador.", usage: { input: 3200, output: 410 }, ...over,
});

// Leitura de mentira: guarda as chamadas para conferir que a IA nem foi chamada.
let next: QuoteReading = reading();
const calls: { mime: string; ctx: { eventName: string; itemTitle: string } }[] = [];
const fake: QuoteReader = async (file, ctx) => {
  calls.push({ mime: file.mime, ctx });
  return next;
};

let ev: string;
let req: string;
let luz: string;

beforeAll(async () => {
  setStorageForTests(memoryStorage());
  const e = await createEvent(await actorFor(db, "admin"), { clientId: d.clients.rock.id, name: "Festa da leitura", startsAt: "2027-11-01T10:00", endsAt: "2027-11-02T22:00" });
  ev = e.id;
  const join = (p: Person, role: "GERENTE" | "PRE_PRODUTOR" | "CLIENTE" | "HEAD") =>
    owner.participant.create({ data: { eventId: ev, userId: d.users[p]!, name: p, email: `${p}-ia@rockfestival.dev`, role, joinedAt: new Date() } });
  await join("marina", "GERENTE");
  await join("sofia", "PRE_PRODUTOR");
  await join("claudia", "CLIENTE");
  const area = (await owner.area.create({ data: { eventId: ev, name: "Infra" } })).id;
  await owner.participant.create({ data: { eventId: ev, userId: d.users.rafael!, name: "rafael", email: "rafael-ia@rockfestival.dev", role: "HEAD", areaId: area, joinedAt: new Date() } });

  const sofia = await actorFor(db, "sofia");
  req = (await createQuote(sofia, ev, { title: "Iluminação do palco", briefing: "Moving heads, 2 diárias.", responsibleId: (await participant("sofia")).id })).id;
  luz = (await createSupplier(sofia, ev, { cnpj: CNPJ.luz, companyName: "Luz Total Eventos Ltda", contactName: "Rui", phone: "(11) 91234-5678", email: "rui@luztotal.dev" })).id;
});

afterAll(async () => {
  await owner.event.update({ where: { id: ev }, data: { deletedAt: new Date() } });
  await Promise.all([db.$disconnect(), owner.$disconnect()]);
});

afterEach(() => {
  next = reading();
  calls.length = 0;
});

const participant = (p: Person) => owner.participant.findFirstOrThrow({ where: { eventId: ev, userId: d.users[p]! } });
const quotesIn = (id: string) => owner.supplierQuote.count({ where: { requestId: id } });

describe("leitura pela IA", () => {
  it("lê o PDF e devolve os campos arrumados, sem salvar nada", async () => {
    const sofia = await actorFor(db, "sofia");
    const r = await readQuoteWithAi(sofia, req, PDF, fake);
    expect(calls).toEqual([{ mime: "application/pdf", ctx: { eventName: "Festa da leitura", itemTitle: "Iluminação do palco" } }]);
    expect(r.fields).toEqual({
      cnpj: "91347865000184", companyName: "Luz & Cia Iluminação Ltda", tradeName: "Luz & Cia", contactName: "Carla Mendes",
      phone: "+55 11 3456-7890", email: "carla@luzecia.dev", totalValue: 18450.51, paymentTerms: "50% na aprovação, 50% em 30 dias",
      notes: "Validade: 15 dias.\nInclui montagem e operador.",
    });
    expect(r.supplierId).toBeNull();
    expect(r.warnings).toEqual([]);
    // Nada foi salvo: nem orçamento, nem fornecedor novo.
    expect(await quotesIn(req)).toBe(0);
    expect(await owner.supplier.count({ where: { cnpj: "91347865000184" } })).toBe(0);
    // A leitura fica no histórico, com o custo em tokens.
    const log = await owner.auditLog.findFirstOrThrow({ where: { entity: "quote_reading", entityId: req }, orderBy: { id: "desc" } });
    expect(log).toMatchObject({ actorUserId: d.users.sofia, eventId: ev, action: "CREATE" });
    expect(log.after).toMatchObject({ fileName: "orcamento-luz.pdf", mime: "application/pdf", inputTokens: 3200, outputTokens: 410, isQuote: true });
  });

  it("confirmar e adicionar é o registro normal, com as mesmas validações", async () => {
    const sofia = await actorFor(db, "sofia");
    const { fields } = await readQuoteWithAi(sofia, req, PDF, fake);
    const q = await addSupplierQuote(sofia, req, { ...fields, totalValue: "18.450,51" }, PDF);
    expect(q).toMatchObject({ cnpj: "91347865000184", totalValue: 18450.51, hasFile: true, newSupplier: true });
    expect(await quotesIn(req)).toBe(1);
  });

  it("fornecedor já cadastrado: devolve o do cadastro; arquivado vira aviso", async () => {
    const sofia = await actorFor(db, "sofia");
    next = reading({ cnpj: "73159024000161" });
    expect((await readQuoteWithAi(sofia, req, PDF, fake)).supplierId).toBe(luz);

    const arq = await createSupplier(sofia, ev, { cnpj: CNPJ.arquivado, companyName: "Velha Luz Ltda" });
    await setSupplierArchived(await actorFor(db, "marina"), ev, arq.id, { archived: true });
    next = reading({ cnpj: CNPJ.arquivado });
    const r = await readQuoteWithAi(sofia, req, PDF, fake);
    expect(r.supplierId).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/Velha Luz Ltda está arquivado/);
    // Volta como estava: os testes do cadastro contam os arquivados da agência.
    await setSupplierArchived(await actorFor(db, "marina"), ev, arq.id, { archived: false });
  });

  it("avisa o que não leu ou não confere, para a pessoa corrigir", async () => {
    next = reading({ isQuote: false, cnpj: "73.159.024/0001-60", phone: "123", email: "carla(at)luz", contactName: null, totalValue: null });
    const r = await readQuoteWithAi(await actorFor(db, "sofia"), req, PDF, fake);
    expect(r.fields).toMatchObject({ cnpj: "73159024000160", phone: "123", totalValue: null, contactName: null });
    expect(r.supplierId).toBeNull();
    expect(r.warnings).toEqual([
      "O arquivo não parece um orçamento. Confira cada campo com cuidado.",
      "O CNPJ lido não confere. Confira no arquivo.",
      "O telefone lido não parece válido. Confira o DDD.",
      "O e-mail lido não parece válido.",
      "Não encontrei o nome do responsável.",
      "Não encontrei o valor total. Confira no arquivo.",
    ]);
  });

  it("Excel, Word e HEIC a IA não lê (nem chega a chamar)", async () => {
    const sofia = await actorFor(db, "sofia");
    await expectStatus(readQuoteWithAi(sofia, req, XLSX, fake), 422);
    await expectStatus(readQuoteWithAi(sofia, req, HEIC, fake), 422);
    await expectStatus(readQuoteWithAi(sofia, req, null, fake), 422);
    expect(calls).toHaveLength(0);
  });

  it("campo, cliente e quem não é do evento não usam (nem chega a chamar)", async () => {
    for (const p of ["rafael", "claudia", "joao", "paulo"] as Person[]) {
      await expectStatus(readQuoteWithAi(await actorFor(db, p), req, PDF, fake), 404);
    }
    expect(calls).toHaveLength(0);
  });

  it("cotação cancelada não lê", async () => {
    const sofia = await actorFor(db, "sofia");
    const outra = (await createQuote(sofia, ev, { title: "Som", briefing: "PA para 2 mil pessoas.", responsibleId: (await participant("sofia")).id })).id;
    await setQuoteState(await actorFor(db, "marina"), outra, { action: "CANCELAR" });
    await expectStatus(readQuoteWithAi(sofia, outra, PDF, fake), 409);
    expect(calls).toHaveLength(0);
  });

  it("sem a chave da Anthropic a leitura fica desligada", async () => {
    const before = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const sofia = await actorFor(db, "sofia");
      expect((await getQuote(sofia, req)).aiReader).toBe(false);
      await expectStatus(readQuoteWithAi(sofia, req, PDF), 503);
      process.env.ANTHROPIC_API_KEY = "teste";
      expect((await getQuote(sofia, req)).aiReader).toBe(true);
    } finally {
      if (before === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = before;
    }
  });

  it(`no máximo ${MAX_AI_READS_PER_HOUR} leituras por pessoa por hora`, async () => {
    const marina = await actorFor(db, "marina");
    await as("marina", (tx) => tx.auditLog.createMany({
      data: Array.from({ length: MAX_AI_READS_PER_HOUR }, () => ({ actorUserId: d.users.marina!, eventId: ev, entity: "quote_reading", entityId: req, action: "CREATE" as const })),
    }));
    await expectStatus(readQuoteWithAi(marina, req, PDF, fake), 429);
    expect(calls).toHaveLength(0);
    // A Sofia segue podendo: o limite é por pessoa.
    await readQuoteWithAi(await actorFor(db, "sofia"), req, PDF, fake);
    expect(calls).toHaveLength(1);
  });
});

describe("chamada à Anthropic (servidor de mentira no lugar da API)", () => {
  let server: Server;
  let reply: { status: number; body: unknown };
  let seen: Record<string, unknown> | null = null;
  const env = { key: process.env.ANTHROPIC_API_KEY, url: process.env.ANTHROPIC_BASE_URL };
  const message = (text: string, stop = "end_turn") => ({
    id: "msg_teste", type: "message", role: "assistant", model: QUOTE_READER_MODEL, stop_reason: stop, stop_sequence: null,
    content: [{ type: "text", text }], usage: { input_tokens: 2100, output_tokens: 300 },
  });
  const out = {
    is_quote: true, cnpj: "91.347.865/0001-84", company_name: "Luz & Cia Iluminação Ltda", trade_name: null, contact_name: "Carla",
    phone: "11 3456-7890", email: "carla@luzecia.dev", total_value: 18450.5, payment_terms: null, notes: "Validade: 15 dias",
  };

  beforeAll(async () => {
    server = createServer((rq, rs) => {
      let raw = "";
      rq.on("data", (c) => (raw += c));
      rq.on("end", () => {
        seen = JSON.parse(raw);
        rs.writeHead(reply.status, { "content-type": "application/json" });
        rs.end(JSON.stringify(reply.body));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.ANTHROPIC_API_KEY = "chave-de-teste";
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
    for (const [k, v] of [["ANTHROPIC_API_KEY", env.key], ["ANTHROPIC_BASE_URL", env.url]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("manda o PDF como documento e pede a resposta no formato combinado", async () => {
    reply = { status: 200, body: message(JSON.stringify(out)) };
    const r = await anthropicQuoteReader({ bytes: PDF.bytes, mime: "application/pdf" }, { eventName: "Festa", itemTitle: "Luz" });
    expect(r).toMatchObject({ isQuote: true, cnpj: "91.347.865/0001-84", companyName: "Luz & Cia Iluminação Ltda", totalValue: 18450.5, usage: { input: 2100, output: 300 } });
    const body = seen as { model: string; output_config: { format: { type: string } }; messages: { content: { type: string; source?: { media_type: string; data: string } }[] }[] };
    expect(body.model).toBe(QUOTE_READER_MODEL);
    expect(body.output_config.format.type).toBe("json_schema");
    const doc = body.messages[0]!.content[0]!;
    expect(doc).toMatchObject({ type: "document", source: { media_type: "application/pdf" } });
    expect(Buffer.from(doc.source!.data, "base64").toString()).toContain("%PDF-1.4");
  });

  it("foto vai como imagem", async () => {
    reply = { status: 200, body: message(JSON.stringify(out)) };
    await anthropicQuoteReader({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), mime: "image/jpeg" }, { eventName: "Festa", itemTitle: "Luz" });
    expect((seen as { messages: { content: { type: string }[] }[] }).messages[0]!.content[0]!.type).toBe("image");
  });

  it("resposta fora do formato, cortada ou recusada vira erro claro", async () => {
    reply = { status: 200, body: message("não é json") };
    await expectStatus(anthropicQuoteReader({ bytes: PDF.bytes, mime: "application/pdf" }, { eventName: "F", itemTitle: "L" }), 422);
    reply = { status: 200, body: message(JSON.stringify(out).slice(0, 40), "max_tokens") };
    await expectStatus(anthropicQuoteReader({ bytes: PDF.bytes, mime: "application/pdf" }, { eventName: "F", itemTitle: "L" }), 422);
    reply = { status: 401, body: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } };
    await expectStatus(anthropicQuoteReader({ bytes: PDF.bytes, mime: "application/pdf" }, { eventName: "F", itemTitle: "L" }), 503);
    reply = { status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "Could not process PDF" } } };
    await expectStatus(anthropicQuoteReader({ bytes: PDF.bytes, mime: "application/pdf" }, { eventName: "F", itemTitle: "L" }), 422);
  });
});
