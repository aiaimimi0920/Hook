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
    expect(source).toContain("const artId = props.artId");
    expect(source).toMatch(/prefetchShader\([\s\S]*artId[\s\S]*true[\s\S]*inputSrc[\s\S]*referenceSrc/);
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
    expect(unitViewSource).toContain("onIntrinsicSizeChange");
    expect(unitViewSource).toContain("onRendered={(dataUrl) => props.onRendered(props.unit.id, dataUrl)}");
    expect(canvasUnitsSource).toContain("onRendered: (id: string, dataUrl: string) => void");
    expect(appSource).toContain("propagateFromUnit(id)");
  });

  it("materializes data URI shader inputs before sending them to Loom", () => {
    const rustSource = readFileSync(resolve(process.cwd(), "src-tauri", "src", "mock_artloom.rs"), "utf8");

    expect(rustSource).toContain("materialize_shader_image_input");
    expect(rustSource).toContain('starts_with("data:")');
    expect(rustSource).toContain("artloom_shader_input");
    expect(rustSource).toContain("artloom_shader_reference");
    expect(rustSource).not.toContain("repair_artloom_art_path");
  });

  it("runs contextual shader prefetch work away from the Tauri IPC handler thread", () => {
    const rustSource = readFileSync(resolve(process.cwd(), "src-tauri", "src", "mock_artloom.rs"), "utf8");

    expect(rustSource).toMatch(/pub\s+async\s+fn\s+prefetch_shader/);
    expect(rustSource).toContain("tauri::async_runtime::spawn_blocking");
    expect(rustSource).toContain("prefetch_shader_blocking");
  });

  it("uses the installed Loom Art package as the only shader-prefetch runtime", () => {
    const rustSource = readFileSync(resolve(process.cwd(), "src-tauri", "src", "mock_artloom.rs"), "utf8");

    expect(rustSource).toContain("read_default_loom_manifest");
    expect(rustSource).toContain("/v1/python-arts/shader/prefetch");
    expect(rustSource).toContain("Loom shader prefetch");
    expect(rustSource).not.toContain("Falling back to local Python shader prefetch");
  });

  it("coalesces interactive WebGL draws and asynchronous PNG persistence", () => {
    const source = readFileSync(resolve(process.cwd(), "src", "components", "ShaderPreview.tsx"), "utf8");

    expect(source).toContain("canvas.toBlob");
    expect(source).toContain("scheduleRendererRender");
    expect(source).toContain("requestAnimationFrame");
    expect(source).toContain("scheduleRenderedExport");
    expect(source).toContain("clearRenderExportTimer");
    expect(source).not.toContain('renderer.toDataURL("image/png")');
  });

  it("keeps shader parameter changes on the local reactive fast path", () => {
    const source = readFileSync(resolve(process.cwd(), "src", "hooks", "useNodeParameters.ts"), "utf8");
    const shaderFastPath = source.indexOf("Shader Arts are entirely reactive in ShaderPreview");
    const imageResolution = source.indexOf("resolveUnitExecutionInputImage({", shaderFastPath);

    expect(shaderFastPath).toBeGreaterThan(-1);
    expect(imageResolution).toBeGreaterThan(shaderFastPath);
    expect(source).not.toContain("renderer.setUniform(paramId");
  });

  it("uses a non-preserved WebGL buffer and caches uniform locations", () => {
    const source = readFileSync(resolve(process.cwd(), "src", "components", "ShaderRenderer.ts"), "utf8");

    expect(source).toContain("preserveDrawingBuffer: false");
    expect(source).toContain("uniformLocations");
    expect(source).toContain("private getUniformLocation");
  });

  it("keeps shader canvases positioned through contain-fit CSS instead of tying canvas attributes to the node frame size", () => {
    const source = readFileSync(resolve(process.cwd(), "src", "components", "ShaderPreview.tsx"), "utf8");

    expect(source).toContain("computeContainFitPlacement");
    expect(source).toContain("onIntrinsicSizeChange");
    expect(source).toContain('position: "absolute"');
    expect(source).toContain('left: `${canvasPlacement().left}px`');
    expect(source).toContain('top: `${canvasPlacement().top}px`');
    expect(source).not.toContain("width={props.width}");
    expect(source).not.toContain("height={props.height}");
  });
});
