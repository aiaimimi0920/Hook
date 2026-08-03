import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("shader and large-image performance contract", () => {
  it("does not synchronously read the full framebuffer in production shader rendering", () => {
    const rendererSource = readSource("src/components/ShaderRenderer.ts");
    const previewSource = readSource("src/components/ShaderPreview.tsx");

    expect(rendererSource).not.toContain("readPixels(");
    expect(rendererSource).not.toContain("hasVisibleContent");
    expect(previewSource).not.toContain("hasVisibleContent");
  });

  it("keeps preview PNG encoding single-flight with a latest-only pending export", () => {
    const previewSource = readSource("src/components/ShaderPreview.tsx");

    expect(previewSource).toContain("let renderExportInFlight = false;");
    expect(previewSource).toContain("let pendingRenderExport: RenderExportRequest | null = null;");
    expect(previewSource).toContain("if (renderExportInFlight)");
    expect(previewSource).toContain("pendingRenderExport = request;");
  });

  it("reclaims renderer caches when units are deleted or a workspace is replaced", () => {
    const graphStoreSource = readSource("src/store/graphStore.ts");
    const cacheSource = readSource("src/services/shaderCache.ts");

    expect(graphStoreSource).toContain("shaderCache.disposeUnit(id);");
    expect(graphStoreSource).toContain("shaderCache.retainRenderersForUnits(");
    expect(cacheSource).toContain("maxEntries: 16");
    expect(cacheSource).toContain("maxEstimatedBytes: 64 * 1024 * 1024");
  });

  it("provides an opt-in real WebGL benchmark for 1080p, 2K, and 4K", () => {
    const packageJson = JSON.parse(readSource("package.json")) as {
      scripts?: Record<string, string>;
    };
    const benchmarkSource = readSource("scripts/shader-benchmark-entry.ts");

    expect(packageJson.scripts?.["bench:shader"]).toBe("node scripts/run-shader-benchmark.mjs");
    expect(benchmarkSource).toContain("{ width: 1920, height: 1080 }");
    expect(benchmarkSource).toContain("{ width: 2560, height: 1440 }");
    expect(benchmarkSource).toContain("{ width: 3840, height: 2160 }");
    expect(benchmarkSource).toContain("const verifyCanvasExport = async");
    expect(benchmarkSource).toContain("rehydration: summarize(restoreSamples)");
  });
});
