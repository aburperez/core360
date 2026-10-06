import "dotenv/config";
import { execFileSync } from "node:child_process";
import { Client } from "pg";
import { createPrismaClient } from "../src/server/db/client";
import { DB_ROLES, ownerDatabaseUrl, rolePassword, type DbRole } from "../src/server/db/urls";
import { seedTraining } from "../prisma/training-data";

/**
 * Prepara o banco na hospedagem (roda no build da Vercel, antes do next build):
 *  1. cria ou atualiza os papéis core_app, core_auth e core_worker, com as
 *     senhas derivadas do segredo (src/server/db/urls.ts);
 *  2. aplica as migrations que faltam;
 *  3. se ADMIN_EMAIL estiver definido, cria a conta do Admin e o evento de treino.
 * Pode rodar a cada deploy: nada é recriado nem apagado.
 */
async function ensureRoles(url: string) {
  const pg = new Client({ connectionString: url });
  await pg.connect();
  try {
    for (const role of Object.keys(DB_ROLES) as DbRole[]) {
      const name = DB_ROLES[role];
      // A senha é base64url (letras, números, - e _), sem aspas para escapar.
      const password = rolePassword(role);
      if (!/^[A-Za-z0-9_-]+$/.test(password)) throw new Error("senha de papel inesperada");
      const { rowCount } = await pg.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [name]);
      await pg.query(
        rowCount
          ? `ALTER ROLE ${name} WITH LOGIN PASSWORD '${password}'`
          : `CREATE ROLE ${name} WITH LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
      );
      console.log(`papel ${name}: ${rowCount ? "atualizado" : "criado"}`);
    }
  } finally {
    await pg.end();
  }
}

async function main() {
  const url = ownerDatabaseUrl();
  if (!url) {
    // Na Vercel, publicar sem banco deixa um app que não abre: melhor parar aqui.
    if (process.env.VERCEL) throw new Error("deploy-db: nenhum banco ligado ao projeto (DATABASE_URL). Ligue o Neon em Storage e publique de novo.");
    console.log("deploy-db: DATABASE_URL não definida, nada a fazer.");
    return;
  }
  await ensureRoles(url);
  execFileSync("prisma", ["migrate", "deploy"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: url },
  });

  const email = process.env.ADMIN_EMAIL;
  if (!email) {
    console.log("deploy-db: ADMIN_EMAIL não definido, evento de treino não criado.");
    return;
  }
  const db = createPrismaClient(url);
  try {
    const r = await seedTraining(db, { email, password: process.env.ADMIN_PASSWORD ?? "", name: process.env.ADMIN_NAME });
    console.log(`deploy-db: admin ${r.adminCreated ? "criado" : "já existia"}, evento de treino ${r.eventCreated ? "criado" : "já existia"}.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
