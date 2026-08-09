import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Hook opportunistic ArtLoom connection", () => {
  it("starts the native instantiation listener during Tauri setup", () => {
    const backendSource = readFileSync(
      resolve(process.cwd(), "src-tauri", "src", "lib.rs"),
      "utf8",
    );

    expect(backendSource).toContain(
      "mock_artloom::ensure_artloom_listener(app.handle(), &mock_artloom)",
    );
    expect(backendSource).toContain("artloom_listener_ready :: started={listener_started}");
  });

  it("attempts the ArtLoom capability handshake at startup even in standalone boot profile", () => {
    const appSource = readFileSync(resolve(process.cwd(), "src", "app.tsx"), "utf8");

    expect(appSource).not.toContain("if (bootProfile?.artLoomEnabled !== false)");
    expect(appSource).toContain("ArtLoom bridge unavailable during startup; continuing in standalone mode.");
  });

  it("refreshes capabilities when the desktop bridge reconnects without checking the static boot flag", () => {
    const appSource = readFileSync(resolve(process.cwd(), "src", "app.tsx"), "utf8");

    expect(appSource).toContain("if (event.payload?.connected) {");
    expect(appSource).not.toContain("event.payload?.connected && bootProfile?.artLoomEnabled !== false");
  });

  it("keeps the desktop handshake non-blocking when ArtLoom is not running", () => {
    const mockArtLoomSource = readFileSync(
      resolve(process.cwd(), "src-tauri", "src", "mock_artloom.rs"),
      "utf8",
    );

    expect(mockArtLoomSource).not.toContain("Duration::from_secs(3)");
    expect(mockArtLoomSource).toContain("let backend_connected = {");
  });
});
