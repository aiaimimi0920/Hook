import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const appSource = fs.readFileSync(path.join(root, "src/app.tsx"), "utf8");
const protocolSource = fs.readFileSync(path.join(root, "src/services/protocol.ts"), "utf8");
const rustClientSource = fs.readFileSync(path.join(root, "src-tauri/src/mock_artloom.rs"), "utf8");
const unitViewSource = fs.readFileSync(path.join(root, "src/components/UnitView.tsx"), "utf8");
const parameterSource = fs.readFileSync(path.join(root, "src/hooks/useNodeParameters.ts"), "utf8");

describe("workflow preview delivery contract", () => {
    it("keeps preview delivery separate from formal outputs and propagation", () => {
        expect(protocolSource).toMatch(/phase\?: "preview" \| "final"/);
        expect(appSource).toMatch(/const phase = delivery\.phase \?\? "final"/);
        expect(appSource).toMatch(/if \(phase === "preview"\) \{[\s\S]*?previewSrc,[\s\S]*?processing: true,[\s\S]*?return;/);

        const previewBranch = appSource.match(/if \(phase === "preview"\) \{[\s\S]*?\n\s*\}/)?.[0] ?? "";
        expect(previewBranch).not.toContain("outputs:");
        expect(previewBranch).not.toContain("propagateFromUnit");
        expect(previewBranch).not.toContain("performWorkflowSync");
        expect(appSource).toMatch(/workflowPreviewSrc[\s\S]*?outputs: nextOutputs/);
        expect(appSource).toContain("const currentUnit = graphStore.units.find");
        expect(appSource).toContain("currentOutputs: currentUnit.data.outputs");
        expect(appSource).toContain("previewSrc: workflowPreviewSrc ?? previewSrc ?? currentUnit.data.previewSrc");
        expect(appSource).toContain("artExecutionRequests.finish(unitId, delivery.request_id)");
        expect(parameterSource).toContain("artExecutionRequests.finish(unitId, requestId)");
        expect(appSource).toContain('if (delivery.phase === "preview")');
        expect(appSource).toContain('"art-delivery-preview-read-failed"');
    });

    it("emits preview phases and continues reading until the final phase", () => {
        expect(rustClientSource).toMatch(/let phase = json\["phase"\][\s\S]*?unwrap_or\("final"\)/);
        expect(rustClientSource).toMatch(/if phase == "preview" \{[\s\S]*?continue;/);
        expect(rustClientSource).toMatch(/"phase": phase/);
        expect(rustClientSource).toMatch(/emit_rgba_art_ready\([\s\S]*?"preview"/);
        expect(rustClientSource).toMatch(/emit_rgba_art_ready\([\s\S]*?"final"/);
    });

    it("keeps local workflow shader previews out of formal downstream propagation", () => {
        expect(appSource).toContain("isIntermediateShaderPreview");
        expect(appSource).toMatch(/if \(!isIntermediateShaderPreview\) \{\s*propagateFromUnit\(id\)/);
        expect(appSource).toMatch(/isIntermediateShaderPreview[\s\S]*?outputs: mergeArtDeliveryOutputs\(/);
        expect(parameterSource).toContain("requiresFormalExecutionAfterPreview");
        expect(unitViewSource).toContain("shaderReferenceInputPortName");
    });
});
