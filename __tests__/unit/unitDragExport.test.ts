import { describe, expect, it } from "vitest";

import {
    buildUnitDragExportFilenameHint,
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
    it("builds art-node filename hints from the capability label", () => {
        const unit = mkUnit({ id: "unit-1234", type: "art" });
        expect(buildUnitDragExportFilenameHint(unit, "图片压缩")).toBe("image_1234");
        expect(buildUnitDragExportFilenameHint(unit, "Image Compress")).toBe("imagecompress_1234");
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
        ).toEqual({
            kind: "path",
            path: "C:\\temp\\compressed.png",
            filenameHint: "imagecompress_rt-1",
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
        ).toEqual({
            kind: "data-url",
            dataUrl: "data:image/png;base64,COMPRESSED",
            filenameHint: "imagecompress_rt-2",
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
        ).toEqual({
            kind: "rendered-composite",
            filenameHint: "image_er-1",
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
