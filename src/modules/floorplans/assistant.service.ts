import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Actor } from "../../server/authz/actor";
import { canManagePlans } from "../../server/authz/policy";
import { AppError, ForbiddenError, ValidationError } from "../../server/errors";
import { sniffImage } from "../attachments/image";
import { loadPlan } from "./floorplans.service";

/**
 * Assistente da planta: o Gerente pede, o Claude olha a planta e SUGERE
 * etapas de montagem e de finalização no formato das etapas (nome, tipo,
 * x e y em % da imagem, área). Nada é gravado aqui: cada sugestão só vira
 * etapa quando o Gerente aprova na tela, pelo createPoint de sempre.
 *
 * A imagem chega do navegador já reduzida (a planta guardada pode passar
 * do limite de 5 MB por imagem da API).
 */

export const MAX_ASSISTANT_BYTES = 3.5 * 1024 * 1024;
const MODEL = "claude-opus-5-5";

const answerSchema = z.object({
  etapas: z.array(
    z.object({
      nome: z.string(),
      descricao: z.string(),
      tipo: z.enum(["MONTAGEM", "FINALIZACAO"]),
      x: z.number(),
      y: z.number(),
      area: z.string().nullable(),
    }),
  ),
  pendencias: z.array(z.string()),
});

export type AssistantAnswer = z.infer<typeof answerSchema>;
export type AssistantInput = { mime: string; base64: string; areas: string[]; existing: string[] };
type Ask = (input: AssistantInput) => Promise<AssistantAnswer>;

const SYSTEM = [
  "Você é o assistente de planejamento de eventos do Core 360.",
  "Você recebe a planta de um evento (palcos, bares, banheiros, acessos, estruturas, saídas de emergência) e sugere as etapas de montagem e de finalização que a equipe de campo marca na planta.",
  "Para cada etapa, dê x e y em % da imagem (0 a 100, a partir do canto de cima à esquerda), no centro do lugar onde ela acontece.",
  "Use só as áreas da lista recebida; quando nenhuma servir, deixe a área vazia.",
  "Não repita etapas que já estão marcadas. Não invente o que a planta não mostra: o que estiver ilegível ou faltando vai em pendencias.",
  "Escreva em português do Brasil, com nomes curtos (até 80 caracteres).",
].join(" ");

let askOverride: Ask | null = null;

/** Só para testes: troca a chamada ao Claude por uma resposta pronta. */
export function setPlanAssistantForTests(fn: Ask | null) {
  askOverride = fn;
}

const askClaude: Ask = async ({ mime, base64, areas, existing }) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AppError("O assistente ainda não foi configurado (falta ANTHROPIC_API_KEY no servidor).", 503, "ASSISTANT_OFF");
  }
  const client = new Anthropic();
  const res = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    // Se o modelo recusar, a própria API refaz o pedido em outro modelo.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "high", format: betaZodOutputFormat(answerSchema) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mime as "image/jpeg" | "image/png" | "image/webp", data: base64 } },
          {
            type: "text",
            text: [
              `Áreas do evento: ${areas.length ? areas.join("; ") : "(nenhuma cadastrada)"}.`,
              `Etapas já marcadas nesta planta: ${existing.length ? existing.join("; ") : "(nenhuma)"}.`,
              "Sugira as etapas que faltam.",
            ].join("\n"),
          },
        ],
      },
    ],
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) {
    throw new AppError("O assistente não conseguiu analisar esta planta. Tente de novo.", 502, "ASSISTANT_FAILED");
  }
  return res.parsed_output;
};

const clamp = (n: number) => Math.min(100, Math.max(0, Number.isFinite(n) ? n : 0));
const norm = (s: string) => s.trim().toLocaleLowerCase("pt-BR");

/** Sugestões de etapas para esta planta (só o gestor). */
export async function suggestPoints(actor: Actor, planId: string, bytes: Uint8Array | null) {
  const plan = await loadPlan(actor, planId);
  if (!canManagePlans(actor, plan.eventId)) throw new ForbiddenError("Só o gerente pede sugestões ao assistente");
  if (!bytes || bytes.length === 0) throw new ValidationError("Envie a imagem da planta");
  if (bytes.length > MAX_ASSISTANT_BYTES) throw new ValidationError("Imagem grande demais para o assistente");
  const image = sniffImage(bytes);
  if (!image || image.mime === "image/heic") throw new ValidationError("Envie a planta em JPG, PNG ou WebP");

  const [areas, points] = await actor.run((tx) =>
    Promise.all([
      tx.area.findMany({ where: { eventId: plan.eventId, deletedAt: null, status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      tx.planPoint.findMany({ where: { eventId: plan.eventId, planId: plan.id }, select: { name: true } }),
    ]),
  );

  const answer = await (askOverride ?? askClaude)({
    mime: image.mime,
    base64: Buffer.from(bytes).toString("base64"),
    areas: areas.map((a) => a.name),
    existing: points.map((p) => p.name),
  });

  const areaByName = new Map(areas.map((a) => [norm(a.name), a]));
  return {
    suggestions: answer.etapas
      .filter((e) => e.nome.trim())
      .map((e) => {
        const area = e.area ? areaByName.get(norm(e.area)) : undefined;
        return {
          name: e.nome.trim().slice(0, 120),
          description: e.descricao.trim().slice(0, 1000) || null,
          kind: e.tipo,
          x: clamp(e.x),
          y: clamp(e.y),
          areaId: area?.id ?? null,
          areaName: area?.name ?? null,
        };
      }),
    pending: answer.pendencias.map((p) => p.trim()).filter(Boolean),
  };
}
