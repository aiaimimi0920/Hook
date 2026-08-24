import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readLoomHookRustSources } from "../helpers/loomHookRustSources";

const root = path.resolve(__dirname, "../..");
const appSource = fs.readFileSync(path.join(root, "src/app.tsx"), "utf8");
const protocolSource = fs.readFileSync(path.join(root, "src/services/protocol.ts"), "utf8");
const rustClientSource = readLoomHookRustSources();
const surfaceControllerSource = fs.readFileSync(path.join(root, "src/components/unitSurfaceController.ts"), "utf8");
const parameterSource = fs.readFileSync(path.join(root, "src/hooks/useNodeParameters.ts"), "utf8");
const surfaceListenerSource = fs.readFileSync(
    path.join(root, "src/services/appSurfaceListeners.ts"),
    "utf8",
);
const artDeliverySource = fs.readFileSync(
    path.join(root, "src/services/appArtDeliveryHandler.ts"),
    "utf8",
);

describe("workflow preview delivery contract", () => {
    it("keeps preview delivery separate from formal outputs and propagation", () => {
        expect(protocolSource).toMatch(/phase\?: "preview" \| "final"/);
        expect(artDeliverySource).toMatch(/const phase = delivery\.phase \?\? "final"/);
        expect(artDeliverySource).toMatch(/if \(phase === "preview"\) \{[\s\S]*?previewSrc,[\s\S]*?processing: true,[\s\S]*?return;/);

        const previewBranch = artDeliverySource.match(/if \(phase === "preview"\) \{[\s\S]*?\n\s*\}/)?.[0] ?? "";
        expect(previewBranch).not.toContain("outputs:");
        expect(previewBranch).not.toContain("propagateFromUnit");
        expect(previewBranch).not.toContain("performWorkflowSync");
        expect(artDeliverySource).toMatch(/workflowPreviewSrc[\s\S]*?outputs: nextOutputs/);
        expect(artDeliverySource).toContain("const currentUnit = graphStore.units.find");
        expect(artDeliverySource).toContain("currentOutputs: currentUnit.data.outputs");
        expect(artDeliverySource).toContain("previewSrc: workflowPreviewSrc ?? previewSrc ?? currentUnit.data.previewSrc");
        expect(artDeliverySource).toContain("artExecutionRequests.finish(unitId, delivery.request_id)");
        expect(appSource).toContain("createAppArtDeliveryHandler(propagateFromUnit)");
        expect(parameterSource).toContain("artExecutionRequests.finish(unitId, requestId)");
        expect(appSource).toContain("registerAppSurfaceListeners");
        expect(surfaceListenerSource).toContain('if (delivery.phase === "preview")');
        expect(surfaceListenerSource).toContain('"art-delivery-preview-read-failed"');
    });

    it("emits preview phases and continues reading until the final phase", () => {
        expect(rustClientSource).toContain('"loom.hook.art.preview" =>');
        expect(rustClientSource).toContain('"loom.hook.art.result" =>');
        expect(rustClientSource).toMatch(/"loom\.hook\.art\.preview" => \{[\s\S]*?"preview"/);
        expect(rustClientSource).toMatch(/"loom\.hook\.art\.result" => \{[\s\S]*?"final"/);
        expect(rustClientSource).toContain("continue;");
    });

    it("keeps local workflow shader previews out of formal downstream propagation", () => {
        expect(appSource).toContain("isIntermediateShaderPreview");
        expect(appSource).toMatch(/if \(!isIntermediateShaderPreview\) \{\s*propagateFromUnit\(id\)/);
        expect(appSource).toMatch(/isIntermediateShaderPreview[\s\S]*?outputs: mergeArtDeliveryOutputs\(/);
        expect(parameterSource).toContain("requiresFormalExecutionAfterPreview");
        expect(surfaceControllerSource).toContain("shaderReferenceInputPortName");
    });

    it("ignores replayed Surface patches after snapshot convergence", () => {
        expect(surfaceListenerSource).toContain(
            "if (delivery.patch.revision <= current.snapshot.revision) return;",
        );
        expect(surfaceListenerSource).toMatch(
            /delivery\.patch\.revision <= current\.snapshot\.revision[\s\S]*?surfaceStore\.actions\.applyPatch/,
        );
    });
});
