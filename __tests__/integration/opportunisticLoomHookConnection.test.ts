import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readHookLibRustSources } from "../helpers/hookLibRustSources";
import { readLoomHookRustSources } from "../helpers/loomHookRustSources";

describe("Hook opt-in authenticated Loom Hook connection", () => {
  it("uses the gated native instantiation listener during Tauri setup", () => {
    const backendSource = readHookLibRustSources();

    expect(backendSource).toContain(
      "loom_hook::ensure_loom_hook_listener(app.handle(), &loom_hook)",
    );
    expect(backendSource).toContain("loom_hook_listener_ready :: started={listener_started}");
    expect(readLoomHookRustSources()).toContain("if !crate::loom_bridge_client::enabled()");
  });

  it("requires explicit opt-in for startup handshakes and extension listeners", () => {
    const startupSource = readFileSync(
      resolve(process.cwd(), "src", "services", "appStartupLifecycle.ts"),
      "utf8",
    );

    expect(startupSource).toContain("refreshLoomHookCapabilitiesOnStartup(refreshCapabilities, bootProfile?.loomHookEnabled === true)");
    expect(startupSource).toContain("if (bootProfile?.loomHookEnabled === true)");
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

  it("routes native connections through trusted discovery rather than anonymous URLs", () => {
    const loomHookSource = readLoomHookRustSources();

    expect(loomHookSource).toContain("crate::loom_bridge_client::connect(");
    expect(loomHookSource).not.toContain("connect(ws_url.as_str())");
    expect(loomHookSource).not.toContain("MaybeTlsStream::Plain");
  });
});
