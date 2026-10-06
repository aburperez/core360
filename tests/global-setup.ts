import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import pg from "pg";
import "dotenv/config";
import type { TestProject } from "vitest/node";

/**
 * Cada execução de testes cria um banco NOVO e descartável (core360_test_<id>),
 * aplica as migrations com `migrate deploy` (não destrutivo) e apaga esse banco
 * no final. Nenhum banco existente é limpo ou resetado.
 *
 * TEST_DATABASE_URL / TEST_APP_DATABASE_URL só fornecem usuário, senha e host;
 * o nome do banco é trocado pelo banco temporário.
 */
declare module "vitest" {
  export interface ProvidedContext {
    ownerUrl: string;
    appUrl: string;
  }
}

function withDatabase(url: string, db: string) {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

export default async function setup(project: TestProject) {
  const baseOwner = process.env.TEST_DATABASE_URL;
  const baseApp = process.env.TEST_APP_DATABASE_URL;
  if (!baseOwner || !baseApp) {
    throw new Error("Defina TEST_DATABASE_URL e TEST_APP_DATABASE_URL (veja .env.example)");
  }

  const dbName = `core360_test_${randomBytes(4).toString("hex")}`;
  const admin = new pg.Client({ connectionString: baseOwner });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${dbName}"`);

  const ownerUrl = withDatabase(baseOwner, dbName);
  execSync("pnpm exec prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: ownerUrl },
    stdio: "pipe",
  });

  project.provide("ownerUrl", ownerUrl);
  project.provide("appUrl", withDatabase(baseApp, dbName));

  return async () => {
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.end();
  };
}
