import { describe, expect, it } from "vitest";
import {
    beginCaptureSelectionState,
    createCaptureMeta,
    createAutoLongCaptureOptions,
    resolveAutoLongCaptureBurstBudget,
    resolveAutoLongCaptureBurstPollInterval,
    resolveAutoLongCapturePollInterval,
    resolveAutoLongCaptureSessionPollInterval,
    resolveShortcutContext,
    shouldLogAutoLongCaptureFrame,
    resolveAutoLongCaptureWheelPollInterval,
    shouldLogAutoLongCaptureWheel,
    shouldDrainAutoLongCaptureBeforeFinish,
    shouldStartCanvasSelectionFromTarget,
    shouldUpdateAutoLongCaptureStatus,
} from "../../src/services/captureState";

const classListContaining = (...classes: string[]) =>
    ({
        contains: (className: string) => classes.includes(className),
    }) as DOMTokenList;

const elementTarget = (target: { tagName?: string; id?: string; classes?: string[] }) =>
    ({
        tagName: target.tagName ?? "DIV",
        id: target.id ?? "",
        classList: classListContaining(...(target.classes ?? [])),
    }) as HTMLElement;

describe("capture state helpers", () => {
    it("starts a new region or long capture only when no capture selection is active", () => {
        expect(beginCaptureSelectionState("region", false)).toEqual({
            shouldStart: true,
            captureMode: "region",
        });
        expect(beginCaptureSelectionState("long-vertical", false)).toEqual({
            shouldStart: true,
            captureMode: "long-vertical",
        });
    });

    it("returns the correct duplicate debug event instead of re-entering capture mode", () => {
        expect(beginCaptureSelectionState("region", true)).toEqual({
            shouldStart: false,
            duplicateDebugEvent: "trigger-capture-ignored-duplicate",
        });
        expect(beginCaptureSelectionState("long-vertical", true)).toEqual({
            shouldStart: false,
            duplicateDebugEvent: "trigger-long-capture-ignored-duplicate",
        });
    });

    it("resolves shortcut context with capture selection taking priority over sticker editing", () => {
        expect(
            resolveShortcutContext({
                isSelecting: true,
                hasSelectedSticker: true,
                hasActiveStickerEditTarget: true,
                stickerEditingDomain: "create",
                stickerTransformMode: "select",
                stickerCanvasTool: "idle",
            }),
        ).toBe("capture-selecting");
        expect(
            resolveShortcutContext({
                isSelecting: false,
                hasSelectedSticker: true,
                hasActiveStickerEditTarget: true,
                stickerEditingDomain: "create",
                stickerTransformMode: "select",
                stickerCanvasTool: "idle",
            }),
        ).toBe("sticker-editing");
        expect(
            resolveShortcutContext({
                isSelecting: false,
                hasSelectedSticker: true,
                hasActiveStickerEditTarget: false,
                stickerEditingDomain: "create",
                stickerTransformMode: "select",
                stickerCanvasTool: "idle",
            }),
        ).toBe("unit-selected");
        expect(
            resolveShortcutContext({
                isSelecting: false,
                hasSelectedSticker: true,
                hasActiveStickerEditTarget: true,
                stickerEditingDomain: "sticker",
                stickerTransformMode: "select",
                stickerCanvasTool: "content-eraser",
            }),
        ).toBe("sticker-editing");
        expect(
            resolveShortcutContext({
                isSelecting: false,
                hasSelectedSticker: true,
                hasActiveStickerEditTarget: false,
                stickerEditingDomain: "sticker",
                stickerTransformMode: "select",
                stickerCanvasTool: "content-eraser",
            }),
        ).toBe("unit-selected");
        expect(
            resolveShortcutContext({
                isSelecting: false,
                hasSelectedSticker: true,
                hasActiveStickerEditTarget: false,
                stickerEditingDomain: "sticker",
                stickerTransformMode: "select",
                stickerCanvasTool: "idle",
            }),
        ).toBe("unit-selected");
        expect(
            resolveShortcutContext({
                isSelecting: false,
                hasSelectedSticker: false,
                hasActiveStickerEditTarget: false,
                stickerEditingDomain: "existing",
                stickerTransformMode: "select",
                stickerCanvasTool: "idle",
            }),
        ).toBe("canvas");
    });

    it("builds capture metadata from the active capture mode and rounded source rect", () => {
        expect(createCaptureMeta("region", { x: 10.4, y: 20.5, w: 30.49, h: 40.5 })).toEqual({
            kind: "region",
            sourceRect: { x: 10, y: 21, w: 30, h: 41 },
            scrollAxis: undefined,
        });
        expect(createCaptureMeta("long-vertical", { x: 10.4, y: 20.5, w: 30.49, h: 40.5 })).toEqual({
            kind: "long",
            sourceRect: { x: 10, y: 21, w: 30, h: 41 },
            scrollAxis: "vertical",
        });
        expect(createCaptureMeta("long-vertical", { x: 10, y: 20, w: 30, h: 40 }, "horizontal")).toEqual({
            kind: "long",
            sourceRect: { x: 10, y: 20, w: 30, h: 40 },
            scrollAxis: "horizontal",
        });
    });

    it("allows selection only from canvas-like background targets", () => {
        expect(shouldStartCanvasSelectionFromTarget(elementTarget({ tagName: "svg" }))).toBe(true);
        expect(shouldStartCanvasSelectionFromTarget(elementTarget({ id: "app-main" }))).toBe(true);
        expect(
            shouldStartCanvasSelectionFromTarget(elementTarget({ classes: ["bg-transparent"] })),
        ).toBe(true);
        expect(shouldStartCanvasSelectionFromTarget(elementTarget({ classes: ["bg-dimmer"] }))).toBe(true);
        expect(
            shouldStartCanvasSelectionFromTarget({
                tagName: "svg",
                closest: (selector: string) =>
                    selector === "[data-sticker-interaction-root='true']" ? ({} as Element) : null,
            } as unknown as EventTarget),
        ).toBe(false);
        expect(shouldStartCanvasSelectionFromTarget(elementTarget({ classes: ["unit-container"] }))).toBe(false);
        expect(shouldStartCanvasSelectionFromTarget(null)).toBe(false);
    });

    it("uses bounded recording options for automatic long capture sessions", () => {
        expect(createAutoLongCaptureOptions({ x: 10, y: 20, w: 300, h: 900 })).toEqual({
            maxScan: 899,
            minOverlapPx: 27,
            minNewContentPx: 2,
            pollIntervalMs: 60,
            minPollIntervalMs: 32,
            maxPollIntervalMs: 120,
            wheelPollIntervalMs: 24,
            burstPollIntervalMs: 24,
            burstWindowMs: 180,
            burstSamplesPerWheel: 1,
            maxBurstSamples: 3,
            wheelDebugLogIntervalMs: 250,
            frameDebugLogIntervalMs: 500,
            statusUpdateIntervalMs: 120,
            finishDrainTimeoutMs: 360,
            finishDrainRecentWheelWindowMs: 220,
        });
        expect(createAutoLongCaptureOptions({ x: 10, y: 20, w: 300, h: 90 }).maxScan).toBe(299);
        expect(createAutoLongCaptureOptions({ x: 10, y: 20, w: 300, h: 90 }).minOverlapPx).toBe(16);
    });

    it("adapts automatic long capture polling to avoid missed overlaps and finish stalls", () => {
        const options = createAutoLongCaptureOptions({ x: 0, y: 0, w: 300, h: 900 });
        expect(resolveAutoLongCapturePollInterval(options)).toBe(60);
        expect(resolveAutoLongCapturePollInterval(options, { status: "duplicate", appendPx: 0 })).toBe(32);
        expect(resolveAutoLongCapturePollInterval(options, { status: "too_small_motion", appendPx: 3 })).toBe(32);
        expect(resolveAutoLongCapturePollInterval(options, { status: "no_overlap", appendPx: 0 })).toBe(32);
        expect(resolveAutoLongCapturePollInterval(options, { status: "weak", appendPx: 30 })).toBe(60);
        expect(resolveAutoLongCapturePollInterval(options, { status: "good", appendPx: 30 })).toBe(80);
        expect(resolveAutoLongCapturePollInterval(options, { status: "good", appendPx: 80 })).toBe(120);
    });

    it("keeps backend-owned long capture sampling responsive without exceeding a bounded capture rate", () => {
        const options = createAutoLongCaptureOptions({ x: 0, y: 0, w: 300, h: 900 });

        expect(resolveAutoLongCaptureSessionPollInterval(options, "recorded")).toBe(60);
        expect(resolveAutoLongCaptureSessionPollInterval(options, "duplicate")).toBe(32);

        expect(
            resolveAutoLongCaptureWheelPollInterval(options, {
                axis: "vertical",
                deltaX: 0,
                deltaY: -1,
            }),
        ).toBe(24);
        expect(
            resolveAutoLongCaptureWheelPollInterval(options, {
                axis: "vertical",
                deltaX: 1,
                deltaY: 0,
            }),
        ).toBe(32);
        expect(
            resolveAutoLongCaptureWheelPollInterval(options, {
                axis: "horizontal",
                deltaX: 2,
                deltaY: 0,
            }),
        ).toBe(24);
        expect(
            resolveAutoLongCaptureWheelPollInterval(options, {
                axis: undefined,
                deltaX: 0,
                deltaY: 0,
            }),
        ).toBeNull();
    });

    it("caps wheel burst budgets and uses drain heuristics before final stitch", () => {
        const options = createAutoLongCaptureOptions({ x: 0, y: 0, w: 300, h: 900 });

        expect(resolveAutoLongCaptureBurstBudget(options, 0)).toBe(1);
        expect(resolveAutoLongCaptureBurstBudget(options, 1)).toBe(2);
        expect(resolveAutoLongCaptureBurstBudget(options, 2)).toBe(3);
        expect(resolveAutoLongCaptureBurstBudget(options, 3)).toBe(3);

        expect(resolveAutoLongCaptureBurstPollInterval(options, 2)).toBe(24);
        expect(resolveAutoLongCaptureBurstPollInterval(options, 0)).toBe(32);

        expect(
            shouldDrainAutoLongCaptureBeforeFinish(options, {
                busy: true,
                burstBudget: 0,
                millisSinceLastWheel: null,
            }),
        ).toBe(true);
        expect(
            shouldDrainAutoLongCaptureBeforeFinish(options, {
                busy: false,
                burstBudget: 2,
                millisSinceLastWheel: null,
            }),
        ).toBe(true);
        expect(
            shouldDrainAutoLongCaptureBeforeFinish(options, {
                busy: false,
                burstBudget: 0,
                millisSinceLastWheel: 120,
            }),
        ).toBe(true);
        expect(
            shouldDrainAutoLongCaptureBeforeFinish(options, {
                busy: false,
                burstBudget: 0,
                millisSinceLastWheel: 220,
            }),
        ).toBe(true);
        expect(
            shouldDrainAutoLongCaptureBeforeFinish(options, {
                busy: false,
                burstBudget: 0,
                millisSinceLastWheel: 320,
            }),
        ).toBe(false);
    });

    it("throttles high-frequency wheel debug logs off the scroll hot path", () => {
        const options = createAutoLongCaptureOptions({ x: 0, y: 0, w: 300, h: 900 });

        expect(shouldLogAutoLongCaptureWheel(options, 1000, 0)).toBe(true);
        expect(shouldLogAutoLongCaptureWheel(options, 1200, 1000)).toBe(false);
        expect(shouldLogAutoLongCaptureWheel(options, 1250, 1000)).toBe(true);
    });

    it("throttles high-frequency frame debug logs off the capture hot path", () => {
        const options = createAutoLongCaptureOptions({ x: 0, y: 0, w: 300, h: 900 });

        expect(shouldLogAutoLongCaptureFrame(options, 2000, 0)).toBe(true);
        expect(shouldLogAutoLongCaptureFrame(options, 2300, 2000)).toBe(false);
        expect(shouldLogAutoLongCaptureFrame(options, 2500, 2000)).toBe(true);
    });

    it("throttles high-frequency status updates during long capture sampling", () => {
        const options = createAutoLongCaptureOptions({ x: 0, y: 0, w: 300, h: 900 });

        expect(shouldUpdateAutoLongCaptureStatus(options, 2000, 0)).toBe(true);
        expect(shouldUpdateAutoLongCaptureStatus(options, 2080, 2000)).toBe(false);
        expect(shouldUpdateAutoLongCaptureStatus(options, 2120, 2000)).toBe(true);
    });
});
