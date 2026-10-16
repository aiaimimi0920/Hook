import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readOtterLibRustSources } from "../helpers/otterLibRustSources";
import { readLoomOtterRustSources } from "../helpers/loomOtterRustSources";

describe("Otter default-on authenticated local Loom connection", () => {
  it("uses the gated native instantiation listener during Tauri setup", () => {
    const backendSource = readOtterLibRustSources();

    expect(backendSource).toContain(
      "loom_otter::ensure_loom_otter_listener(app.handle(), &loom_otter)",
    );
    expect(backendSource).toContain("loom_otter_listener_ready :: started={listener_started}");
    expect(readLoomOtterRustSources()).toContain("if !crate::loom_bridge_client::enabled()");
  });

  it("respects the native boot policy for startup handshakes and extension listeners", () => {
    const startupSource = readFileSync(
      resolve(process.cwd(), "src/app/appStartupLifecycle.ts"),
      "utf8",
    );

    expect(startupSource).toContain("refreshLoomOtterCapabilitiesOnStartup(refreshCapabilities, bootProfile?.loomOtterEnabled === true)");
    expect(startupSource).toContain("if (bootProfile?.loomOtterEnabled === true)");
    expect(startupSource).toContain("Loom Otter bridge unavailable during startup; continuing in standalone mode.");
  });

  it("refreshes capabilities when the desktop bridge reconnects without checking the static boot flag", () => {
    const listenerSource = readFileSync(
      resolve(process.cwd(), "src/app/appArtControlListeners.ts"),
      "utf8",
    );

    expect(listenerSource).toContain("if (!event.payload?.connected) {");
    expect(listenerSource).toContain("await refreshCapabilities();");
    expect(listenerSource).not.toContain("bootProfile?.loomOtterEnabled");
  });

  it("routes native connections through trusted discovery rather than anonymous URLs", () => {
    const loomOtterSource = readLoomOtterRustSources();

    expect(loomOtterSource).toContain("crate::loom_bridge_client::connect(");
    expect(loomOtterSource).not.toContain("connect(ws_url.as_str())");
    expect(loomOtterSource).not.toContain("MaybeTlsStream::Plain");
  });
});
