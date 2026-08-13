import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Hook opportunistic Loom Hook connection", () => {
  it("starts the native instantiation listener during Tauri setup", () => {
    const backendSource = readFileSync(
      resolve(process.cwd(), "src-tauri", "src", "lib.rs"),
      "utf8",
    );

    expect(backendSource).toContain(
      "loom_hook::ensure_loom_hook_listener(app.handle(), &loom_hook)",
    );
    expect(backendSource).toContain("loom_hook_listener_ready :: started={listener_started}");
  });

  it("attempts the Loom Hook capability handshake at startup even in standalone boot profile", () => {
    const appSource = readFileSync(resolve(process.cwd(), "src", "app.tsx"), "utf8");

    expect(appSource).not.toContain("if (bootProfile?.loomHookEnabled !== false)");
    expect(appSource).toContain("Loom Hook bridge unavailable during startup; continuing in standalone mode.");
  });

  it("refreshes capabilities when the desktop bridge reconnects without checking the static boot flag", () => {
    const appSource = readFileSync(resolve(process.cwd(), "src", "app.tsx"), "utf8");

    expect(appSource).toContain("if (event.payload?.connected) {");
    expect(appSource).not.toContain("event.payload?.connected && bootProfile?.loomHookEnabled !== false");
  });

  it("keeps the desktop handshake non-blocking when Loom Hook is not running", () => {
    const loomHookSource = readFileSync(
      resolve(process.cwd(), "src-tauri", "src", "loom_hook.rs"),
      "utf8",
    );

    expect(loomHookSource).not.toContain("Duration::from_secs(3)");
    expect(loomHookSource).toContain("connect(ws_url.as_str())");
  });
});
