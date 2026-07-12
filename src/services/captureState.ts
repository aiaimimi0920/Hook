import type {
    StickerCanvasTool,
    StickerCaptureMeta,
    StickerEditingDomain,
    StickerTransformMode,
} from "../types/stickerEditing";

export type CaptureSelectionMode = "region" | "long-vertical";

export type CaptureShortcutContext =
    | "capture-selecting"
    | "sticker-editing"
    | "unit-selected"
    | "canvas";

export type CaptureDuplicateDebugEvent =
    | "trigger-capture-ignored-duplicate"
    | "trigger-long-capture-ignored-duplicate";

export interface CaptureRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface ManualLongCaptureFrame {
    base64: string;
    width: number;
    height: number;
    filePath?: string | null;
    fileUrl?: string | null;
}

export type LongCaptureAxis = "vertical" | "horizontal";
export type LongCaptureDirection = "down" | "up" | "right" | "left";
export type LongCaptureAnalysisStatus = "duplicate" | "too_small_motion" | "good" | "weak" | "no_overlap";

export interface AutoLongCaptureOptions {
    maxScan: number;
    minOverlapPx: number;
    minNewContentPx: number;
    pollIntervalMs: number;
    minPollIntervalMs: number;
    maxPollIntervalMs: number;
    wheelPollIntervalMs: number;
    burstPollIntervalMs: number;
    burstWindowMs: number;
    burstSamplesPerWheel: number;
    maxBurstSamples: number;
    wheelDebugLogIntervalMs: number;
    frameDebugLogIntervalMs: number;
    statusUpdateIntervalMs: number;
    finishDrainTimeoutMs: number;
    finishDrainRecentWheelWindowMs: number;
}

export interface LongCaptureOverlapAnalysis {
    status: LongCaptureAnalysisStatus;
    axis?: LongCaptureAxis;
    direction?: LongCaptureDirection;
    overlapPx: number;
    cropStartPx: number;
    appendPx: number;
    confidence: number;
    seamPx: number;
}

export type CaptureSelectionStartState =
    | {
          shouldStart: true;
          captureMode: CaptureSelectionMode;
      }
    | {
          shouldStart: false;
          duplicateDebugEvent: CaptureDuplicateDebugEvent;
      };

export const isLongCaptureMode = (mode: CaptureSelectionMode) => mode === "long-vertical";

export const getCaptureDuplicateDebugEvent = (mode: CaptureSelectionMode): CaptureDuplicateDebugEvent =>
    isLongCaptureMode(mode) ? "trigger-long-capture-ignored-duplicate" : "trigger-capture-ignored-duplicate";

export const beginCaptureSelectionState = (
    requestedMode: CaptureSelectionMode,
    currentlySelecting: boolean,
): CaptureSelectionStartState => {
    if (currentlySelecting) {
        return {
            shouldStart: false,
            duplicateDebugEvent: getCaptureDuplicateDebugEvent(requestedMode),
        };
    }

    return {
        shouldStart: true,
        captureMode: requestedMode,
    };
};

export const resolveShortcutContext = (input: {
    isSelecting: boolean;
    hasSelectedSticker: boolean;
    hasActiveStickerEditTarget: boolean;
    stickerEditingDomain: StickerEditingDomain;
    stickerTransformMode: StickerTransformMode;
    stickerCanvasTool: StickerCanvasTool;
}): CaptureShortcutContext => {
    if (input.isSelecting) return "capture-selecting";
    if (!input.hasSelectedSticker) return "canvas";
    if (!input.hasActiveStickerEditTarget) return "unit-selected";
    if (input.stickerEditingDomain === "create") {
        return "sticker-editing";
    }
    if (input.stickerEditingDomain === "sticker") {
        return input.stickerCanvasTool === "idle" ? "unit-selected" : "sticker-editing";
    }
    return input.stickerTransformMode !== "select" ? "sticker-editing" : "unit-selected";
};

export const createCaptureMeta = (
    mode: CaptureSelectionMode,
    rect: CaptureRect,
    scrollAxis?: LongCaptureAxis,
): StickerCaptureMeta => ({
    kind: isLongCaptureMode(mode) ? "long" : "region",
    sourceRect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.w),
        h: Math.round(rect.h),
    },
    scrollAxis: isLongCaptureMode(mode) ? (scrollAxis ?? "vertical") : undefined,
});

export const resolveAutoLongCapturePollInterval = (
    options: AutoLongCaptureOptions,
    analysis?: Pick<LongCaptureOverlapAnalysis, "status" | "appendPx"> | null,
): number => {
    if (!analysis) return options.pollIntervalMs;

    switch (analysis.status) {
        case "duplicate":
        case "too_small_motion":
        case "no_overlap":
            return options.minPollIntervalMs;
        case "weak":
            return options.pollIntervalMs;
        case "good":
            return analysis.appendPx >= 48
                ? options.maxPollIntervalMs
                : Math.min(options.maxPollIntervalMs, options.pollIntervalMs + 20);
    }
};

export const resolveAutoLongCaptureSessionPollInterval = (
    options: AutoLongCaptureOptions,
    status: "recorded" | "duplicate",
): number => {
    switch (status) {
        case "recorded":
            return options.pollIntervalMs;
        case "duplicate":
            return options.minPollIntervalMs;
    }
};

export const resolveAutoLongCaptureWheelPollInterval = (
    options: AutoLongCaptureOptions,
    input: {
        axis?: LongCaptureAxis;
        deltaX?: number;
        deltaY?: number;
    },
): number | null => {
    const deltaX = Math.abs(input.deltaX ?? 0);
    const deltaY = Math.abs(input.deltaY ?? 0);
    if (deltaX === 0 && deltaY === 0) return null;

    switch (input.axis) {
        case "horizontal":
            return deltaX > 0 ? options.wheelPollIntervalMs : options.minPollIntervalMs;
        case "vertical":
            return deltaY > 0 ? options.wheelPollIntervalMs : options.minPollIntervalMs;
        default:
            return Math.max(deltaX, deltaY) > 0 ? options.wheelPollIntervalMs : null;
    }
};

export const resolveAutoLongCaptureBurstBudget = (
    options: AutoLongCaptureOptions,
    currentBudget: number,
): number => Math.min(
    options.maxBurstSamples,
    Math.max(0, currentBudget) + options.burstSamplesPerWheel,
);

export const resolveAutoLongCaptureBurstPollInterval = (
    options: AutoLongCaptureOptions,
    burstBudget: number,
): number => (burstBudget > 0 ? options.burstPollIntervalMs : options.minPollIntervalMs);

export const shouldDrainAutoLongCaptureBeforeFinish = (
    options: AutoLongCaptureOptions,
    input: {
        busy: boolean;
        burstBudget: number;
        millisSinceLastWheel: number | null;
    },
): boolean => {
    if (input.busy) return true;
    if (input.burstBudget > 0) return true;
    return input.millisSinceLastWheel != null
        && input.millisSinceLastWheel <= options.finishDrainRecentWheelWindowMs;
};

export const shouldLogAutoLongCaptureWheel = (
    options: AutoLongCaptureOptions,
    nowMs: number,
    lastLogAtMs: number,
): boolean => lastLogAtMs <= 0 || nowMs - lastLogAtMs >= options.wheelDebugLogIntervalMs;

export const shouldLogAutoLongCaptureFrame = (
    options: AutoLongCaptureOptions,
    nowMs: number,
    lastLogAtMs: number,
): boolean => lastLogAtMs <= 0 || nowMs - lastLogAtMs >= options.frameDebugLogIntervalMs;

export const shouldUpdateAutoLongCaptureStatus = (
    options: AutoLongCaptureOptions,
    nowMs: number,
    lastUpdateAtMs: number,
): boolean => lastUpdateAtMs <= 0 || nowMs - lastUpdateAtMs >= options.statusUpdateIntervalMs;

export const createAutoLongCaptureOptions = (rect: CaptureRect): AutoLongCaptureOptions => ({
    maxScan: Math.max(32, Math.round(Math.max(rect.w, rect.h)) - 1),
    minOverlapPx: Math.max(16, Math.round(Math.max(rect.w, rect.h) * 0.03)),
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

const hasClass = (target: Partial<HTMLElement>, className: string) =>
    typeof target.classList?.contains === "function" && target.classList.contains(className);

export const shouldStartCanvasSelectionFromTarget = (target: EventTarget | null): boolean => {
    if (!target) return false;

    const element = target as Partial<HTMLElement>;
    const tagName = typeof element.tagName === "string" ? element.tagName.toLowerCase() : "";
    const insideStickerInteractionRoot =
        typeof element.closest === "function" &&
        !!element.closest("[data-sticker-interaction-root='true']");
    if (insideStickerInteractionRoot) {
        return false;
    }
    return (
        tagName === "svg" ||
        element.id === "app-main" ||
        hasClass(element, "bg-transparent") ||
        hasClass(element, "bg-dimmer")
    );
};
