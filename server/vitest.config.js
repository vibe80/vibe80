import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.js"],
    setupFiles: ["tests/setup/env.js"],
    clearMocks: true,
    restoreMocks: true,
  },
  coverage: {
    provider: "v8",
    reporter: ["text", "html"],
    reportsDirectory: "./coverage",
    thresholds: {
      lines: 50,
      functions: 50,
      branches: 40,
      statements: 50,
    },
  },
});
