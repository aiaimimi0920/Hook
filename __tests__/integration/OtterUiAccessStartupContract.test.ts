import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readOtterLibRustSources } from "../helpers/otterLibRustSources";

const otterRoot = process.cwd();
const buildRsPath = resolve(otterRoot, "src-tauri/build.rs");
const tauriConfigPath = resolve(otterRoot, "src-tauri/tauri.conf.json");

const buildRsSource = readFileSync(buildRsPath, "utf8");
const libRsSource = readOtterLibRustSources();
const tauriConfigSource = readFileSync(tauriConfigPath, "utf8");

describe("Otter UIAccess startup contract", () => {
  it("marks UIAccess builds at compile time so runtime startup can branch without changing the default build", () => {
    expect(buildRsSource).toContain("cargo:rustc-env=HOOK_WINDOWS_UIACCESS_BUILD=1");
    expect(libRsSource).toContain("HOOK_WINDOWS_UIACCESS_BUILD");
    expect(libRsSource).toContain("uiaccess_build_enabled");
  });

  it("does not hardcode always-on-top in the static Tauri window config because UIAccess builds must defer topmost promotion until the frontend is mounted", () => {
    expect(tauriConfigSource).toContain("\"alwaysOnTop\": false");
  });

  it("defers UIAccess overlay promotion until after the frontend reports mounted, then finalizes the staged overlay startup", () => {
    expect(libRsSource).toContain("frontend-mounted");
    expect(libRsSource).toContain("uiaccess_overlay_startup_staged");
    expect(libRsSource).toContain("uiaccess_overlay_startup_finalize_requested");
    expect(libRsSource).toContain("show_overlay_host_impl(&window, pending_click_through)");
  });
});
