import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../src/services/api", () => ({ api: {
    focusOverlayWindow: vi.fn(async () => {}), debugLogEvent: vi.fn(async () => {}),
} }));
vi.mock("../../src/services/syncService", () => ({ syncService: {
    updateBackendRects: vi.fn(async () => {}), performWorkflowSync: vi.fn(async () => {}),
} }));
vi.mock("../../src/services/historyModel", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../src/services/historyModel")>(),
    createThumbnailDataUrl: vi.fn(async () => ({ thumbnail: null })),
}));
import { addCaptureUnit } from "../../src/hooks/captureUnitController";
import { graphStore } from "../../src/store/graphStore";
beforeEach(() => graphStore.setUnits([]));
describe("captured pixel placement", () => {
    it("uses native clipped bounds rather than requested origin or current browser DPI", async () => {
        const captureRect = { x: 100 / 1.5, y: 103 / 1.5, w: 301 / 1.5, h: 207 / 1.5 };
        await addCaptureUnit({ base64: "fixture", width: 301, height: 207, captureRect },
            { x: 67, y: 69, w: 201, h: 138 }, { x: 67, y: 69 }, "region");
        expect(graphStore.units[0]).toMatchObject(captureRect);
    });
    it("keeps the legacy origin and pixel-size fallback for stitched captures", async () => {
        await addCaptureUnit({ base64: "fixture", width: 300, height: 900 },
            { x: 10, y: 20, w: 300, h: 200 }, { x: 10, y: 20 }, "long-vertical");
        expect(graphStore.units[0]).toMatchObject({ x: 10, y: 20, w: 300 / window.devicePixelRatio, h: 900 / window.devicePixelRatio });
    });
});
