import { afterEach, describe, expect, it, vi } from "vitest";
import { graphStore } from "../../src/store/graphStore";
import { uiActions } from "../../src/store/uiStore";
import { pasteSystemClipboardEntry } from "../../src/services/stickerClipboardPaste";
import { getTextAnnotationMetrics } from "../../src/services/stickerTextGeometry";

vi.mock("../../src/services/syncService", () => ({ syncService: {
    updateBackendRects: vi.fn(async () => {}), performWorkflowSync: vi.fn(async () => {}),
} }));
afterEach(() => { graphStore.actions.replaceUnits([]); uiActions.clearStickerHistory("target"); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function addTarget() {
    graphStore.actions.addUnit({ id: "target", type: "sticker", x: 20, y: 30, w: 300, h: 200,
        params: {}, inputs: [], outputs: [], data: { src: "original.png" } });
}
describe("clipboard selection commits", () => {
    it("adds centered multiline text without changing the image and records undo", async () => {
        addTarget();
        const undo = vi.spyOn(uiActions, "pushStickerHistory");
        await pasteSystemClipboardEntry("target", { id: "1", kind: "text", content: "第一行\n第二行" }, () => true);
        const unit = graphStore.units[0];
        expect(unit.data.src).toBe("original.png");
        const elements = unit.data.annotationState!.elements;
        expect(elements).toHaveLength(2);
        const centers = elements.map((annotation) => {
            if (annotation.type !== "text") throw new Error("Expected text");
            const metrics = getTextAnnotationMetrics(annotation);
            expect(annotation.x + metrics.width / 2).toBeCloseTo(150);
            return metrics.centerY;
        });
        expect((centers[0] + centers[1]) / 2).toBeCloseTo(100);
        expect(undo).toHaveBeenCalledOnce();
    });
    it("does not paste after the target menu is dismissed", async () => {
        addTarget();
        await pasteSystemClipboardEntry("target", { id: "1", kind: "text", content: "stale" }, () => false);
        expect(graphStore.units[0].data.annotationState).toBeUndefined();
    });
    it("creates an independent proportional image sticker without overwriting the target", async () => {
        addTarget();
        vi.stubGlobal("Image", class {
            src = ""; naturalWidth = 800; naturalHeight = 400;
            async decode() {}
        });
        const content = "data:image/png;base64,AQID";
        await pasteSystemClipboardEntry("target", { id: "image", kind: "image", content }, () => true);
        expect(graphStore.units).toHaveLength(2);
        expect(graphStore.units[0].data.src).toBe("original.png");
        expect(graphStore.units[1]).toMatchObject({ w: 600, h: 300, data: { src: content } });
    });
    it("discards an image decode completed after menu dismissal", async () => {
        addTarget();
        let resolve!: () => void;
        let current = true;
        vi.stubGlobal("Image", class {
            src = ""; naturalWidth = 100; naturalHeight = 100;
            decode() { return new Promise<void>((done) => { resolve = done; }); }
        });
        const paste = pasteSystemClipboardEntry("target", { id: "image", kind: "image", content: "data:image/png;base64,AQID" }, () => current);
        current = false; resolve(); await paste;
        expect(graphStore.units).toHaveLength(1);
    });
});
