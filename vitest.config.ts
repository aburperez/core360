import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    globalSetup: ["tests/global-setup.ts"],
    // Os testes de banco compartilham o mesmo banco de teste.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
