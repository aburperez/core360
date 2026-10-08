import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectStatus } from "../helpers";
import { memoryStorage, setStorageForTests } from "@/server/storage/storage";
import { createPoint, deletePlan, uploadPlan } from "@/modules/floorplans/floorplans.service";
import { MAX_ASSISTANT_BYTES, setPlanAssistantForTests, suggestPoints, type AssistantInput } from "@/modules/floorplans/assistant.service";

/**
 * Assistente da planta: só o Gerente pede, o Claude (aqui, uma resposta
 * pronta) sugere etapas e nada é gravado até alguém aprovar.
 */

const db = appDb();
const d = demo();
const rock = d.events.rock.id;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);

let planId = "";
let asked: AssistantInput | null = null;

beforeAll(async () => {
  setStorageForTests(memoryStorage());
  setPlanAssistantForTests(async (input) => {
    asked = input;
    return {
      etapas: [
        { nome: "  Montagem do palco principal ", descricao: "Estrutura e cobertura", tipo: "MONTAGEM", x: 42.5, y: 18, area: "infraestrutura" },
        { nome: "Desmontagem dos bares", descricao: "", tipo: "FINALIZACAO", x: 130, y: -4, area: "Área que não existe" },
        { nome: "   ", descricao: "sem nome", tipo: "MONTAGEM", x: 10, y: 10, area: null },
      ],
      pendencias: ["Saídas de emergência não indicadas na legenda", " "],
    };
  });
  const plan = await uploadPlan(await actorFor(db, "marina"), rock, { name: "Assistente" }, PNG);
  planId = plan.id;
  await createPoint(await actorFor(db, "marina"), planId, { name: "Gerador", kind: "MONTAGEM", x: 5, y: 5 });
});

afterAll(async () => {
  setPlanAssistantForTests(null);
  await deletePlan(await actorFor(db, "marina"), planId);
  await db.$disconnect();
});

describe("Assistente da planta", () => {
  it("só o gerente pede sugestões; os heads e a equipe não", async () => {
    await expectStatus(suggestPoints(await actorFor(db, "rafael"), planId, PNG), 403);
    await expectStatus(suggestPoints(await actorFor(db, "joao"), planId, PNG), 403);
    await expectStatus(suggestPoints(await actorFor(db, "beatriz"), planId, PNG), [403, 404]);
    await expectStatus(suggestPoints(await actorFor(db, "marina"), "nao-e-uuid", PNG), 404);
  });

  it("recusa imagem vazia, grande demais ou que não é imagem", async () => {
    const marina = await actorFor(db, "marina");
    await expectStatus(suggestPoints(marina, planId, null), 422);
    await expectStatus(suggestPoints(marina, planId, new Uint8Array(MAX_ASSISTANT_BYTES + 1)), 422);
    await expectStatus(suggestPoints(marina, planId, new TextEncoder().encode("%PDF-1.4 não convertido")), 422);
  });

  it("manda áreas e etapas já marcadas, e devolve sugestões limpas sem gravar nada", async () => {
    const marina = await actorFor(db, "marina");
    const before = await marina.run((tx) => tx.planPoint.count({ where: { planId } }));
    const r = await suggestPoints(marina, planId, PNG);

    expect(asked?.mime).toBe("image/png");
    expect(asked?.areas).toEqual(expect.arrayContaining(["Infraestrutura", "A&B"]));
    expect(asked?.existing).toEqual(["Gerador"]);

    expect(r.suggestions).toHaveLength(2);
    expect(r.suggestions[0]).toMatchObject({
      name: "Montagem do palco principal", kind: "MONTAGEM", x: 42.5, y: 18,
      areaId: d.areas.infra.id, areaName: "Infraestrutura", description: "Estrutura e cobertura",
    });
    // Posição fora da imagem volta para a borda; área desconhecida fica vazia.
    expect(r.suggestions[1]).toMatchObject({ kind: "FINALIZACAO", x: 100, y: 0, areaId: null, description: null });
    expect(r.pending).toEqual(["Saídas de emergência não indicadas na legenda"]);
    expect(await marina.run((tx) => tx.planPoint.count({ where: { planId } }))).toBe(before);

    // Aprovada pelo gerente, a sugestão vira etapa pelo caminho de sempre.
    const { name, description, kind, x, y, areaId } = r.suggestions[0]!;
    await createPoint(marina, planId, { name, description, kind, x, y, areaId });
    expect(await marina.run((tx) => tx.planPoint.count({ where: { planId } }))).toBe(before + 1);
  });

  it("sem a chave da API, avisa que o assistente não está configurado", async () => {
    setPlanAssistantForTests(null);
    const key = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expectStatus(suggestPoints(await actorFor(db, "marina"), planId, PNG), 503);
    } finally {
      if (key !== undefined) process.env.ANTHROPIC_API_KEY = key;
    }
  });
});
