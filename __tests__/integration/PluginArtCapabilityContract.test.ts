import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readLoomHookRustSources } from "../helpers/loomHookRustSources";

const source = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("plugin Art capability boundary", () => {
  it("keeps sample Art ids out of Hook production source", () => {
    const sampleIds = [
      "custom-1770146354922",
      "custom-remove-bg-cloud",
      "custom-image-search",
      "custom-1770131241684",
      "custom-image-blend-script",
      "custom-image-blend-compress-workflow",
      "custom-stock-monitor",
    ];
    const productionFiles = [
      "src/app.tsx",
      "src/components/UnitParamsCandidateResults.tsx",
      "src/components/UnitParamsExpandedSettings.tsx",
      "src/components/UnitParamsPanel.tsx",
      "src/components/UnitParamsPortRows.tsx",
      "src/components/UnitParamsScrollRegion.tsx",
      "src/components/UnitView.tsx",
      "src/hooks/useNodeParameters.ts",
      "src/services/protocol.ts",
      "src/types/unit.ts",
    ];

    for (const relativePath of productionFiles) {
      const text = source(relativePath);
      for (const sampleId of sampleIds) {
        expect(text, `${relativePath} must not contain ${sampleId}`).not.toContain(sampleId);
      }
    }
  });

  it("renders candidate results through generic capability/result contracts", () => {
    const candidateResults = source("src/components/UnitParamsCandidateResults.tsx");
    const protocol = source("src/services/protocol.ts");

    expect(candidateResults).not.toContain("imageSearch");
    expect(candidateResults).not.toContain("搜索结果");
    expect(candidateResults).toContain("候选");
    expect(protocol).toContain("ArtResultCandidate");
    expect(protocol).toContain("candidates?: ArtResultCandidateMetadata");
  });

  it("activates shader behavior from capability metadata instead of a concrete execution enum", () => {
    const surfaceController = source("src/components/unitSurfaceController.ts");
    const parameters = source("src/hooks/useNodeParameters.ts");
    const protocol = source("src/services/protocol.ts");

    expect(surfaceController).toContain("supportsShaderPreview");
    expect(parameters).toContain("supportsShaderPreview");
    expect(parameters).not.toContain("artCapability?.execution_type === 'shader'");
    expect(protocol).toContain("capabilities?: ArtCapabilityMetadata");
  });

  it("delegates every enabled package Art to Loom instead of maintaining an execution whitelist", () => {
    const backend = readLoomHookRustSources();
    const tauriEntry = source("src-tauri/src/lib.rs");

    expect(backend).toContain('"method": "loom.hook.art.execute"');
    expect(backend).not.toContain('"method": "art/process"');
    expect(backend).not.toContain("effective_execution_type");
    expect(backend).not.toContain("core.image.pixelate");
    expect(backend).not.toContain("core.image.blur");
    expect(backend).not.toContain("crate::cli_engine");
    expect(tauriEntry).not.toContain("native_cli_execute");
    expect(tauriEntry).not.toContain("mod cli_engine;");
    expect(existsSync(resolve(process.cwd(), "src-tauri", "src", "cli_engine.rs"))).toBe(false);
  });

  it("uses a bounded response timeout longer than Loom's framework process budget", () => {
    const backend = readLoomHookRustSources();

    expect(backend).toContain("Duration::from_secs(150)");
    expect(backend).not.toContain("ARTLOOM_WS_RESPONSE_GRACE_SECS");
    expect(backend).not.toContain("AHRP");
  });
});
