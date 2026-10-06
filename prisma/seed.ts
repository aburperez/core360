import "dotenv/config";
import { createPrismaClient } from "../src/server/db/client";
import { seedDemo } from "./demo-data";

// Roda com o papel dono (DATABASE_URL). Não é usado em produção.
async function main() {
  const db = createPrismaClient(process.env.DATABASE_URL!);
  try {
    const exists = await db.event.findFirst({ where: { name: "Rock Festival 2027" } });
    if (exists) {
      console.log("Seed já aplicado: Rock Festival 2027 existe. Use `pnpm db:reset` para recriar.");
      return;
    }
    const data = await seedDemo(db);
    console.log(
      `Seed ok: ${Object.keys(data.participants).length} participantes, ` +
        `${Object.keys(data.teams).length} equipes, ${Object.keys(data.occurrences).length} ocorrências.`,
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
