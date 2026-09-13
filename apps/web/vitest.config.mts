import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: {
    "@": fileURLToPath(new URL("./", import.meta.url)),
    "server-only": fileURLToPath(new URL("../../node_modules/next/dist/compiled/server-only/empty.js", import.meta.url)),
  } },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    css: true,
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
    coverage: { reporter: ["text", "html"] },
  },
});
