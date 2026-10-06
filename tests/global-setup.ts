import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import pg from "pg";
import "dotenv/config";
import type { TestProject } from "vitest/node";
import { createPrismaClient } from "../src/server/db/client";
import { seedDemo, type DemoData } from "../prisma/demo-data";

/**
 * Cada execução de testes cria um banco NOVO e descartável (core360_test_<id>),
 * aplica as migrations com `migrate deploy` (não destrutivo), roda o seed de
 * demonstração uma vez e apaga esse banco no final. Nenhum banco existente é
 * limpo ou resetado.
 *
 * As URLs TEST_* só fornecem usuário, senha e host; o nome do banco é trocado.
 */
declare module "vitest" {
  export interface ProvidedContext {
    ownerUrl: string;
    appUrl: string;
    authUrl: string;
    workerUrl: string;
    demo: DemoData;
  }
}

function withDatabase(url: string, db: string) {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

export default async function setup(project: TestProject) {
  const base = {
    owner: process.env.TEST_DATABASE_URL,
    app: process.env.TEST_APP_DATABASE_URL,
    auth: process.env.TEST_AUTH_DATABASE_URL,
    worker: process.env.TEST_WORKER_DATABASE_URL,
  };
  if (!base.owner || !base.app || !base.auth || !base.worker) {
    throw new Error("Defina TEST_DATABASE_URL, TEST_APP_DATABASE_URL, TEST_AUTH_DATABASE_URL e TEST_WORKER_DATABASE_URL (veja .env.example)");
  }

  const dbName = `core360_test_${randomBytes(4).toString("hex")}`;
  const admin = new pg.Client({ connectionString: base.owner });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${dbName}"`);

  const ownerUrl = withDatabase(base.owner, dbName);
  execSync("pnpm exec prisma migrate deploy", { env: { ...process.env, DATABASE_URL: ownerUrl }, stdio: "pipe" });

  const owner = createPrismaClient(ownerUrl);
  const demo = await seedDemo(owner);
  await owner.$disconnect();

  project.provide("ownerUrl", ownerUrl);
  project.provide("appUrl", withDatabase(base.app, dbName));
  project.provide("authUrl", withDatabase(base.auth, dbName));
  project.provide("workerUrl", withDatabase(base.worker, dbName));
  project.provide("demo", JSON.parse(JSON.stringify(demo)));

  return async () => {
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.end();
  };
}
