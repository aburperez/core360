import { inject } from "vitest";
import { createPrismaClient } from "@/server/db/client";
import { loadActor, type Actor } from "@/server/authz/actor";
import { pgErrorCode as pgCode } from "@/server/db/errors";
import type { DemoData } from "../prisma/demo-data";

export { pgCode };

export const ownerDb = () => createPrismaClient(inject("ownerUrl"));
export const appDb = () => createPrismaClient(inject("appUrl"));
export const authDb = () => createPrismaClient(inject("authUrl"));
export const workerDb = () => createPrismaClient(inject("workerUrl"));

/** IDs do cenário Rock Festival 2027, criado uma vez por execução (global-setup). */
export const demo = (): DemoData => inject("demo");

export type Person = keyof DemoData["users"];

/** Monta o usuário como o backend monta numa requisição real. */
export async function actorFor(db: ReturnType<typeof appDb>, person: Person): Promise<Actor> {
  const id = demo().users[person];
  if (!id) throw new Error(`${person} não tem login`);
  const a = await loadActor(db, id);
  if (!a) throw new Error(`${person} está inativo`);
  return a;
}

/** Espera que a promessa falhe com o SQLSTATE informado. */
export async function expectPgError(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (err) {
    const got = pgCode(err);
    if (got !== code) {
      throw new Error(`esperava SQLSTATE ${code}, recebi ${got ?? "nenhum"}: ${String(err)}`);
    }
    return;
  }
  throw new Error(`esperava falha com SQLSTATE ${code}, mas a operação foi aceita`);
}

/** Espera que a promessa falhe com um erro de domínio de certo status HTTP. */
export async function expectStatus(p: Promise<unknown>, status: number | number[]) {
  const ok = Array.isArray(status) ? status : [status];
  try {
    await p;
  } catch (err) {
    const got = (err as { status?: number }).status;
    if (got === undefined || !ok.includes(got)) throw new Error(`esperava erro ${ok.join(" ou ")}, recebi ${got ?? "outro"}: ${String(err)}`);
    return;
  }
  throw new Error(`esperava erro ${ok.join(" ou ")}, mas a operação foi aceita`);
}

/**
 * Hierarquia de acessos: o Pré-produtor só abre as partes marcadas para ele.
 * Os testes de cada parte liberam o que o Pré-produtor tinha antes das caixas
 * (tudo menos Painel executivo, Fechamento financeiro e Atendimento).
 */
export async function grantAllSections(owner: ReturnType<typeof ownerDb>, eventId: string) {
  await owner.$executeRaw`
    INSERT INTO producer_access (participant_id, event_id, sections, updated_at)
    SELECT id, event_id, app.legacy_producer_sections(), now() FROM participants
     WHERE event_id = ${eventId}::uuid AND role = 'PRE_PRODUTOR'
    ON CONFLICT (participant_id) DO NOTHING`;
}
