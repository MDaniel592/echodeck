import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/**/*.integration.test.ts"],
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
})
