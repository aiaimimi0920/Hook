import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Hook core dependency slimming", () => {
  it("does not keep unused desktop plugins and dead Rust dependencies in the Lite core", () => {
    const cargoTomlPath = path.resolve(process.cwd(), "src-tauri/Cargo.toml");
    const libRsPath = path.resolve(process.cwd(), "src-tauri/src/lib.rs");
    const packageJsonPath = path.resolve(process.cwd(), "package.json");
    const capabilityPath = path.resolve(process.cwd(), "src-tauri/capabilities/default.json");

    const cargoToml = fs.readFileSync(cargoTomlPath, "utf8");
    const libRs = fs.readFileSync(libRsPath, "utf8");
    const packageJson = fs.readFileSync(packageJsonPath, "utf8");
    const capability = fs.readFileSync(capabilityPath, "utf8");

    expect(cargoToml).not.toContain('tauri-plugin-opener');
    expect(cargoToml).not.toContain('tauri-plugin-fs');
    expect(cargoToml).not.toContain('tauri-plugin-dialog');
    expect(cargoToml).not.toContain('tauri-plugin-drag');
    expect(cargoToml).not.toContain('chrono =');
    expect(cargoToml).not.toContain('regex =');
    expect(cargoToml).not.toContain('raw-window-handle');
    expect(cargoToml).not.toContain('tracing =');
    expect(cargoToml).not.toContain('features = ["full"]');

    expect(libRs).not.toContain('tauri_plugin_fs::init()');
    expect(libRs).not.toContain('tauri_plugin_dialog::init()');
    expect(libRs).not.toContain('tauri_plugin_opener::init()');

    expect(packageJson).not.toContain('@tauri-apps/plugin-opener');
    expect(packageJson).not.toContain('@crabnebula/tauri-plugin-drag');

    expect(capability).not.toContain('opener:default');
    expect(capability).not.toContain('fs:default');
    expect(capability).not.toContain('dialog:default');
  });
});
