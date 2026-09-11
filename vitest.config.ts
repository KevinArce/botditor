import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // TypeScript sources only — never compiled .js copies left in src/.
    include: ["src/**/*.test.ts"],
  },
});
