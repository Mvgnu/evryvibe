import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
  // Integration suites share the explicitly disposable TEST_DATABASE_URL.
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 15000,
    fileParallelism: false,
  },
});
