import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readHookLibRustSources } from "../helpers/hookLibRustSources";

describe("Hook opportunistic Loom Hook connection", () => {
  it("starts the native instantiation listener during Tauri setup", () => {
    const backendSource = readHookLibRustSources();

    expect(backendSource).toContain(
      "loom_hook::ensure_loom_hook_listener(app.handle(), &loom_hook)",
    );
    expect(backendSource).toContain("loom_hook_listener_ready :: started={listener_started}");
  });

  it("attempts the Loom Hook capability handshake at startup even in standalone boot profile", () => {
    const startupSource = readFileSync(
      resolve(process.cwd(), "src", "services", "appStartupLifecycle.ts"),
      "utf8",
    );

    expect(startupSource).toContain("refreshLoomHookCapabilitiesOnStartup(refreshCapabilities)");
    expect(startupSource).not.toContain("if (bootProfile?.loomHookEnabled !== false)");
    expect(startupSource).toContain("Loom Hook bridge unavailable during startup; continuing in standalone mode.");
  });

  it("refreshes capabilities when the desktop bridge reconnects without checking the static boot flag", () => {
    const listenerSource = readFileSync(
      resolve(process.cwd(), "src", "services", "appArtControlListeners.ts"),
      "utf8",
    );

    expect(listenerSource).toContain("if (!event.payload?.connected) {");
    expect(listenerSource).toContain("await refreshCapabilities();");
    expect(listenerSource).not.toContain("bootProfile?.loomHookEnabled");
  });

  it("keeps the desktop handshake non-blocking when Loom Hook is not running", () => {
    // Inspect the production handshake, not unrelated test-server timeouts.
    const loomHookSource = readFileSync(resolve(process.cwd(), "src-tauri", "src", "loom_hook", "handshake.rs"), "utf8");

    expect(loomHookSource).not.toContain("Duration::from_secs(3)");
    expect(loomHookSource).toContain("connect_authenticated_hook_socket(ws_url.as_str())");
    expect(loomHookSource).toContain("tauri::async_runtime::spawn_blocking");
  });
});
