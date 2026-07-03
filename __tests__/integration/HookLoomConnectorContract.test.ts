import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("Hook Loom connector contract", () => {
  it("exposes a Hook-owned Loom connector surface separate from ArtLoom", () => {
    const apiSource = readSource("src/services/api.ts");
    const libSource = readSource("src-tauri/src/lib.rs");
    const loomRustPath = resolve(process.cwd(), "src-tauri", "src", "loom_connector.rs");
    const loomFrontendPath = resolve(process.cwd(), "src", "services", "loomConnector.ts");

    expect(existsSync(loomRustPath)).toBe(true);
    expect(existsSync(loomFrontendPath)).toBe(true);

    const loomRustSource = readFileSync(loomRustPath, "utf8");
    const loomFrontendSource = readFileSync(loomFrontendPath, "utf8");

    expect(libSource).toContain("pub mod loom_connector;");
    expect(libSource).toContain("async fn loom_brain_plan");
    expect(libSource).toContain("loom_connector::invoke_brain_plan");
    expect(libSource).toContain("loom_brain_plan,");

    expect(apiSource).toContain("export interface LoomBrainPlanRequest");
    expect(apiSource).toContain("export interface LoomBrainPlanResult");
    expect(apiSource).toContain("invokeLoomBrainPlan");
    expect(apiSource).toContain('safeInvoke("loom_brain_plan"');

    expect(loomFrontendSource).toContain("export const loomConnector");
    expect(loomFrontendSource).toContain("createLoomConnector");
    expect(loomFrontendSource).toContain("brainPlan");
    expect(loomFrontendSource).toContain("invokeLoomBrainPlan");
    expect(loomFrontendSource).not.toContain("artLoomIpcRequest");
    expect(loomFrontendSource).not.toContain("browserArtLoomRequest");
    expect(loomFrontendSource).not.toContain("listenBrowserArtLoomMethod");
    expect(loomFrontendSource).not.toContain("artLoomClient");
    expect(loomFrontendSource).not.toContain("mock_artloom");

    expect(loomRustSource).toContain("validate_loom_manifest");
    expect(loomRustSource).toContain("is_loopback_base_url");
    expect(loomRustSource).toContain("build_brain_plan_envelope");
    expect(loomRustSource).toContain("brain.plan");
    expect(loomRustSource).not.toContain("mock_artloom");
  });
});
