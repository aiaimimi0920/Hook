import { configDefaults, defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

export default defineConfig(({ mode }) => ({
  base: "./",
  // Vitest's module runner must not load the dev-server refresh virtual module.
  plugins: [solid({ hot: mode !== "test" })],
  envPrefix: ["VITE_", "TAURI_"],
  test: {
    // These tests use node:test so Vitest must not collect them as empty suites.
    exclude: [...configDefaults.exclude, "scripts/tests/**"],
    setupFiles: ["./__tests__/setup/vitest.setup.ts"],
  },
  server: {
    strictPort: true,
    port: 1420,
  },
  build: {
    outDir: ".output/public",
    emptyOutDir: true,
    assetsDir: "_build/assets",
    manifest: "_build/.vite/manifest.json",
    rollupOptions: {
      output: {
        // Framework code changes less often than Hook features and is safe to
        // cache independently from the application entry graph.
        manualChunks(id) {
          return id.includes("/node_modules/") ? "vendor" : undefined;
        },
      },
    },
  },
}));
