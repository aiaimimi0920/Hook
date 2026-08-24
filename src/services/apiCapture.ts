// Owns native region, window-target, and long-capture command routing.
import type {
    CaptureWindowTarget,
    LongCaptureAxis,
    LongCaptureDirection,
    LongCaptureOverlapAnalysis,
} from "./captureState";
import { safeInvoke } from "./apiTransport";
import type {
    CaptureRegionOptions,
    CaptureResponse,
    PreciseSelectionResult,
} from "./apiTypes";

export const captureApi = {
    captureRegion: (
        x: number,
        y: number,
        w: number,
        h: number,
        options?: CaptureRegionOptions,
    ): Promise<CaptureResponse> => {
        return safeInvoke("capture_region", {
            x,
            y,
            w,
            h,
            compositionOverlayAlpha: options?.compositionOverlayAlpha,
        });
    },

    listCaptureWindowTargets: (): Promise<CaptureWindowTarget[]> =>
        safeInvoke("list_capture_window_targets", undefined, () => [], false),

    getCaptureCursorPosition: (): Promise<{ x: number; y: number }> =>
        safeInvoke("get_capture_cursor_position", undefined, () => ({ x: 0, y: 0 }), false),

    captureVerticalLongRegion: (
        x: number,
        y: number,
        w: number,
        h: number,
        options?: {
            maxFrames?: number;
            scrollDelta?: number;
            settleMs?: number;
            overlapScan?: number;
        },
    ): Promise<CaptureResponse> =>
        safeInvoke("capture_vertical_long_region", {
            x,
            y,
            w,
            h,
            maxFrames: options?.maxFrames,
            scrollDelta: options?.scrollDelta,
            settleMs: options?.settleMs,
            overlapScan: options?.overlapScan,
        }),

    stitchVerticalLongCaptureFrames: (
        frames: string[],
        options?: { overlapScan?: number },
    ): Promise<CaptureResponse> =>
        safeInvoke("stitch_vertical_long_capture_frames", {
            frames,
            overlapScan: options?.overlapScan,
        }),

    analyzeLongCapturePair: (
        previous: string,
        current: string,
        options?: {
            axis?: LongCaptureAxis;
            direction?: LongCaptureDirection;
            maxScan?: number;
            minOverlapPx?: number;
            minNewContentPx?: number;
        },
    ): Promise<LongCaptureOverlapAnalysis> =>
        safeInvoke("analyze_long_capture_pair", {
            previous,
            current,
            axis: options?.axis,
            direction: options?.direction,
            maxScan: options?.maxScan,
            minOverlapPx: options?.minOverlapPx,
            minNewContentPx: options?.minNewContentPx,
        }),

    stitchLongCaptureFrames: (
        frames: string[],
        options?: {
            axis?: LongCaptureAxis;
            direction?: LongCaptureDirection;
            maxScan?: number;
            minOverlapPx?: number;
        },
    ): Promise<CaptureResponse> =>
        safeInvoke("stitch_long_capture_frames", {
            frames,
            axis: options?.axis,
            direction: options?.direction,
            maxScan: options?.maxScan,
            minOverlapPx: options?.minOverlapPx,
        }),

    startLongCaptureSession: (
        rect: { x: number; y: number; w: number; h: number },
        axis?: LongCaptureAxis,
    ): Promise<string> =>
        safeInvoke("start_long_capture_session", { rect, axis }),

    sampleLongCaptureSession: (sessionId: string): Promise<{
        status: "recorded" | "duplicate";
        frameCount: number;
        duplicateCount: number;
        recorded: boolean;
        axis?: LongCaptureAxis | null;
        direction?: LongCaptureDirection | null;
    }> =>
        safeInvoke("sample_long_capture_session", { sessionId }),

    finishLongCaptureSession: (sessionId: string): Promise<CaptureResponse> =>
        safeInvoke("finish_long_capture_session", { sessionId }),

    cancelLongCaptureSession: (sessionId: string): Promise<void> =>
        safeInvoke("cancel_long_capture_session", { sessionId }),

    getPreciseSelection: (
        x: number,
        y: number,
        w: number,
        h: number,
    ): Promise<PreciseSelectionResult | null> =>
        safeInvoke("get_precise_selection", { x, y, w, h }),
};
