import { afterEach, describe, expect, it, vi } from "vitest";
import { parseProjectionInvitation, projectionOrigin, sanitizeProjectionLink } from "../../src/services/qrProjectionProtocol";
import { mapUnitToSessionSticker } from "../../src/services/sessionStickerPayload";
import { mapSessionStickerToUnit } from "../../src/services/sessionStickerMapping";
import { createProjectionReceiverUnit, patchProjection } from "../../src/services/qrProjectionSession";
import { syncService } from "../../src/services/syncService";
import { graphStore } from "../../src/store/graphStore";
import { projectionEnvelope, projectionResponse, projectionUnit } from "../fixtures/qrProjection";

afterEach(() => { graphStore.actions.replaceUnits([]); vi.restoreAllMocks(); });

describe("projection invitation and persistence boundary", () => {
    it("restores association metadata, including an offline stop, and strips extra fields", () => {
        const unit = projectionUnit();
        unit.data.qrProjection!.stopPending = true;
        const saved = mapUnitToSessionSticker(unit);
        const restored = mapSessionStickerToUnit(JSON.parse(JSON.stringify(saved)), { capabilities: [] });
        expect(restored.data.qrProjection).toMatchObject(unit.data.qrProjection!);
        expect(sanitizeProjectionLink({ ...unit.data.qrProjection, privateKey: "untrusted-extra" }, unit.id)).not.toHaveProperty("privateKey");
        expect(sanitizeProjectionLink(unit.data.qrProjection, "copied-unit")).toBeUndefined();
        expect(mapSessionStickerToUnit({ ...saved, id: "copied-unit" }, { capabilities: [] }).data.qrProjection).toBeUndefined();
    });

    it.each(["http://192.168.1.5:9000", "https://user:password@server.test", "https://server.test/path", "https://server.test?a=1", "https://server.test#fragment", "file:///tmp/image", "https://server.test\\evil"])("rejects unsafe network origin %s", (origin) => {
        expect(() => projectionOrigin(origin)).toThrow();
        expect(() => parseProjectionInvitation(JSON.stringify({ ...projectionEnvelope(), serverOrigin: origin }))).toThrow();
    });

    it("parses without network access, rejects missing signatures and excessive envelopes", () => {
        expect(parseProjectionInvitation(JSON.stringify(projectionEnvelope()))).toEqual(projectionEnvelope());
        expect(() => parseProjectionInvitation(JSON.stringify({ ...projectionEnvelope(), signature: undefined }))).toThrow();
        expect(() => parseProjectionInvitation(" ".repeat(4097))).toThrow();
    });

    it("updates receiver pixels while retaining local geometry, annotations and crop", () => {
        vi.spyOn(syncService, "performWorkflowSync").mockResolvedValue(undefined);
        const unit = createProjectionReceiverUnit("receiver", projectionResponse(), { width: 800, height: 600 });
        unit.x = 333; unit.y = 222; unit.w = 75; unit.h = 50;
        unit.data.opacityNormal = 0.4;
        unit.data.annotationState = { elements: [], serialCounter: 0 };
        unit.data.rasterizedAnnotationLayerSrc = "data:image/png;base64,local";
        unit.data.imageEditState = { cropRect: { x: 1, y: 2, w: 30, h: 40 }, contentEraseStrokes: [] };
        graphStore.actions.addUnit(unit);
        patchProjection("receiver", { ...unit.data.qrProjection!, revision: 2, digest: "b".repeat(64) }, btoa("b"));
        expect(graphStore.units[0]).toMatchObject({ x: 333, y: 222, w: 75, h: 50, data: {
            opacityNormal: 0.4, annotationState: { elements: [] }, imageEditState: unit.data.imageEditState,
            rasterizedAnnotationLayerSrc: "data:image/png;base64,local", src: `data:image/png;base64,${btoa("b")}`,
        } });
        patchProjection("receiver", undefined);
        expect(graphStore.units[0].data.src).toBe(`data:image/png;base64,${btoa("b")}`);
    });
});
