import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

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
    ];
    const productionFiles = [
      "src/app.tsx",
      "src/components/UnitParamsPanel.tsx",
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
    const panel = source("src/components/UnitParamsPanel.tsx");
    const protocol = source("src/services/protocol.ts");

    expect(panel).not.toContain("imageSearch");
    expect(panel).not.toContain("搜索结果");
    expect(panel).toContain("候选");
    expect(protocol).toContain("ArtResultCandidate");
    expect(protocol).toContain("candidates?: ArtResultCandidateMetadata");
  });

  it("activates shader behavior from capability metadata instead of a concrete execution enum", () => {
    const unitView = source("src/components/UnitView.tsx");
    const parameters = source("src/hooks/useNodeParameters.ts");
    const protocol = source("src/services/protocol.ts");

    expect(unitView).toContain("supportsShaderPreview");
    expect(parameters).toContain("supportsShaderPreview");
    expect(parameters).not.toContain("artCapability?.execution_type === 'shader'");
    expect(protocol).toContain("capabilities?: ArtCapabilityMetadata");
  });
});
