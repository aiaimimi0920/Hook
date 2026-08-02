import { describe, expect, it } from "vitest";

import {
    resolveNativeDragDropPhysicalPointFromOverlay,
    resolveNativeDragDropPhysicalPointFromPointer,
    resolveExistingUnitDragFilePath,
    resolveUnitDragExportPlan,
} from "../../src/services/unitDragExport";
import type { Unit } from "../../src/types/unit";

const mkUnit = (over: Partial<Unit> & { id: string }): Unit => ({
    type: "sticker",
    x: 0,
    y: 0,
    w: 100,
    h: 80,
    params: {},
    inputs: [],
    outputs: [],
    data: {},
    ...over,
});

describe("unit drag export planning", () => {
    it("preserves Unicode capability labels in the structured naming context", () => {
        const unit = mkUnit({
            id: "unit-1234",
            type: "art",
            data: { previewSrc: "data:image/png;base64,ART" },
        });
        expect(
            resolveUnitDragExportPlan({ unit, capabilityLabel: "图片压缩" })?.fileNamingContext,
        ).toMatchObject({
            kind: "art",
            label: "图片压缩",
            unitId: "unit-1234",
            shortId: "1234",
        });
    });

    it("reuses a file-backed art result directly", () => {
        const unit = mkUnit({
            id: "art-1",
            type: "art",
            data: {
                filePath: "C:\\temp\\compressed.png",
            },
        });

        expect(resolveExistingUnitDragFilePath(unit)).toBe("C:\\temp\\compressed.png");
        expect(
            resolveUnitDragExportPlan({
                unit,
                capabilityLabel: "Image Compress",
                displaySrc: "http://asset.localhost/C%3A/temp/compressed.png",
            }),
        ).toMatchObject({
            kind: "path",
            path: "C:\\temp\\compressed.png",
            cacheSavedPath: false,
        });
    });

    it("exports a base64-backed art result without forcing sticker compositing", () => {
        const unit = mkUnit({
            id: "art-2",
            type: "art",
            data: {
                previewSrc: "data:image/png;base64,COMPRESSED",
            },
        });

        expect(
            resolveUnitDragExportPlan({
                unit,
                capabilityLabel: "Image Compress",
                displaySrc: "data:image/png;base64,COMPRESSED",
            }),
        ).toMatchObject({
            kind: "data-url",
            dataUrl: "data:image/png;base64,COMPRESSED",
            cacheSavedPath: true,
        });
    });

    it("keeps sticker exports on the rendered composite path when no reusable file exists", () => {
        const unit = mkUnit({
            id: "sticker-1",
            type: "sticker",
            data: {
                previewSrc: "data:image/png;base64,DISPLAY",
                annotationState: {
                    elements: [],
                },
            },
        });

        expect(resolveExistingUnitDragFilePath(unit)).toBeUndefined();
        expect(
            resolveUnitDragExportPlan({
                unit,
                displaySrc: "data:image/png;base64,DISPLAY",
            }),
        ).toMatchObject({
            kind: "rendered-composite",
            cacheSavedPath: true,
        });
    });

    it("exports a sticker's current upstream display instead of its stale stored paths", () => {
        const unit = mkUnit({
            id: "sticker-2",
            type: "sticker",
            data: {
                src: "asset://localhost/C:/temp/original.png",
                filePath: "C:\\temp\\original.png",
                dragOutFilePath: "C:\\temp\\previous-export.png",
            },
        });

        expect(
            resolveUnitDragExportPlan({
                unit,
                displaySrc: "data:image/png;base64,CURRENT_ART_RESULT",
            }),
        ).toMatchObject({
            kind: "rendered-composite",
            cacheSavedPath: true,
        });
    });

    it("does not arm drag export for an art node that has no produced image yet", () => {
        const unit = mkUnit({
            id: "art-3",
            type: "art",
            data: {},
        });

        expect(
            resolveUnitDragExportPlan({
                unit,
                capabilityLabel: "Image Compress",
            }),
        ).toBeNull();
    });

    it("uses the overlay hook's physical global release coordinates for drag export target resolution", () => {
        expect(
            resolveNativeDragDropPhysicalPointFromOverlay({
                x: 1565.3333333333333,
                y: 862.6666666666666,
                globalX: 2348,
                globalY: 1294,
                scaleFactor: 1.5,
                physicalOriginX: 0,
                physicalOriginY: 0,
            }),
        ).toEqual({
            x: 2348,
            y: 1294,
        });
    });

    it("falls back to physical screen coordinates for DOM pointer releases when the overlay hook payload is unavailable", () => {
        expect(
            resolveNativeDragDropPhysicalPointFromPointer(
                {
                    clientX: 1565.3333333333333,
                    clientY: 862.6666666666666,
                    screenX: 1565.3333333333333,
                    screenY: 862.6666666666666,
                },
                1.5,
            ),
        ).toEqual({
            x: 2348,
            y: 1294,
        });
    });
});
