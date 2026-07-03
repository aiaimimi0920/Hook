import { defineConfig } from "@solidjs/start/config";

export default defineConfig({
  ssr: false,
  server: {
    preset: "static",
  },
  vite: {
    // Tauri specific Vite config
    clearScreen: false,
    server: {
      strictPort: true,
      port: 1420
    },
    envPrefix: ["VITE_", "TAURI_"],
  }
});
