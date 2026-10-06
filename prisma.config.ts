import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Migrations usam a conexão direta quando houver (Neon: DATABASE_URL_UNPOOLED).
    // Na Vercel quem roda é scripts/deploy-db.ts, que acha o banco por qualquer prefixo.
    url: process.env["DATABASE_URL_UNPOOLED"] || process.env["DATABASE_URL"],
  },
});
