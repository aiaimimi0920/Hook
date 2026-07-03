import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Color Transfer shader node contract", () => {
  it("does not cache contextual shader arts before their image context is known", () => {
    const appSource = readFileSync(resolve(process.cwd(), "src", "app.tsx"), "utf8");

    expect(appSource).toContain("isContextualShaderArt");
    expect(appSource).toMatch(/shaderArts[\s\S]*filter\(\(art\) => !isContextualShaderArt\(art\)\)/);
  });

  it("refreshes LUT shaders with source and reference images instead of loading reference as an unused texture", () => {
    const source = readFileSync(resolve(process.cwd(), "src", "components", "ShaderPreview.tsx"), "utf8");

    expect(source).toContain("referenceImageSrc");
    expect(source).toContain("props.artPath");
    expect(source).toMatch(/prefetchShader\([\s\S]*props\.artId[\s\S]*props\.artPath[\s\S]*true[\s\S]*inputSrc[\s\S]*referenceSrc/);
    expect(source).toContain('key === "reference"');
    expect(source).toContain("props.onRendered");
  });

  it("passes connected Color Transfer input/reference images and writes shader output back to the graph", () => {
    const unitViewSource = readFileSync(resolve(process.cwd(), "src", "components", "UnitView.tsx"), "utf8");
    const canvasUnitsSource = readFileSync(resolve(process.cwd(), "src", "components", "CanvasUnits.tsx"), "utf8");
    const appSource = readFileSync(resolve(process.cwd(), "src", "app.tsx"), "utf8");

    expect(unitViewSource).toContain("getShaderInputSrc");
    expect(unitViewSource).toContain("getShaderReferenceSrc");
    expect(unitViewSource).toContain("referenceImageSrc={getShaderReferenceSrc()}");
    expect(unitViewSource).toContain("onRendered={(dataUrl) => props.onRendered(props.unit.id, dataUrl)}");
    expect(canvasUnitsSource).toContain("onRendered: (id: string, dataUrl: string) => void");
    expect(appSource).toContain("propagateFromUnit(id)");
  });

  it("repairs stale ArtLoom art paths and materializes data URI shader inputs for Python", () => {
    const rustSource = readFileSync(resolve(process.cwd(), "src-tauri", "src", "mock_artloom.rs"), "utf8");

    expect(rustSource).toContain("repair_artloom_art_path");
    expect(rustSource).toContain("materialize_shader_image_input");
    expect(rustSource).toContain('starts_with("data:")');
    expect(rustSource).toContain("artloom_shader_input");
    expect(rustSource).toContain("artloom_shader_reference");
  });

  it("runs contextual shader prefetch work away from the Tauri IPC handler thread", () => {
    const rustSource = readFileSync(resolve(process.cwd(), "src-tauri", "src", "mock_artloom.rs"), "utf8");

    expect(rustSource).toMatch(/pub\s+async\s+fn\s+prefetch_shader/);
    expect(rustSource).toContain("tauri::async_runtime::spawn_blocking");
    expect(rustSource).toContain("prefetch_shader_blocking");
  });

  it("exports rendered shader output asynchronously instead of blocking on canvas.toDataURL", () => {
    const source = readFileSync(resolve(process.cwd(), "src", "components", "ShaderPreview.tsx"), "utf8");

    expect(source).toContain("canvas.toBlob");
    expect(source).not.toContain('renderer.toDataURL("image/png")');
  });
});
