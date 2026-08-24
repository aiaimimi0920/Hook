import { api } from "../services/api";
import type { CaptureRect } from "../services/captureState";
import {
    isSelecting,
    preciseRect,
    selectionRect,
    setPreciseRect,
} from "../store/uiStore";

const PRECISE_SELECTION_DEBOUNCE_MS = 80;

const captureRectsMatch = (left: CaptureRect | null, right: CaptureRect | null) =>
    Boolean(
        left
        && right
        && left.x === right.x
        && left.y === right.y
        && left.w === right.w
        && left.h === right.h,
    );

type PreciseSelectionControllerDependencies = {
    getCaptureSessionGeneration: () => number;
    isCaptureSessionCurrent: (generation: number) => boolean;
};

/** Debounces UIAutomation lookup and rejects every result from stale pointer state. */
export function createPreciseSelectionController(
    dependencies: PreciseSelectionControllerDependencies,
) {
    let preciseRequestGeneration = 0;
    let preciseRequestTimer: number | null = null;
    let preciseRequestSource: CaptureRect | null = null;
    let preciseRectSource: CaptureRect | null = null;

    const invalidate = () => {
        if (
            preciseRequestTimer === null
            && preciseRequestSource === null
            && preciseRectSource === null
            && preciseRect() === null
        ) {
            return;
        }
        if (preciseRequestTimer !== null) {
            window.clearTimeout(preciseRequestTimer);
            preciseRequestTimer = null;
        }
        preciseRequestGeneration += 1;
        preciseRequestSource = null;
        preciseRectSource = null;
        setPreciseRect(null);
    };

    const schedule = (sourceRect: CaptureRect) => {
        if (captureRectsMatch(preciseRequestSource, sourceRect)) return;
        if (preciseRequestTimer !== null) {
            window.clearTimeout(preciseRequestTimer);
            preciseRequestTimer = null;
        }

        const requestGeneration = preciseRequestGeneration + 1;
        preciseRequestGeneration = requestGeneration;
        preciseRequestSource = sourceRect;
        preciseRectSource = null;
        setPreciseRect(null);
        const sessionGeneration = dependencies.getCaptureSessionGeneration();

        preciseRequestTimer = window.setTimeout(async () => {
            preciseRequestTimer = null;
            try {
                const dpr = window.devicePixelRatio || 1;
                const rect = await api.getPreciseSelection(
                    sourceRect.x * dpr,
                    sourceRect.y * dpr,
                    sourceRect.w * dpr,
                    sourceRect.h * dpr,
                );
                if (
                    requestGeneration !== preciseRequestGeneration
                    || !dependencies.isCaptureSessionCurrent(sessionGeneration)
                    || !isSelecting()
                    || !captureRectsMatch(selectionRect(), sourceRect)
                    || !captureRectsMatch(preciseRequestSource, sourceRect)
                ) {
                    return;
                }

                if (rect) {
                    preciseRectSource = sourceRect;
                    setPreciseRect({
                        x: rect.x / dpr,
                        y: rect.y / dpr,
                        w: rect.w / dpr,
                        h: rect.h / dpr,
                    });
                } else {
                    preciseRectSource = null;
                    setPreciseRect(null);
                }
            } catch {
                if (requestGeneration === preciseRequestGeneration) {
                    preciseRectSource = null;
                    setPreciseRect(null);
                }
            }
        }, PRECISE_SELECTION_DEBOUNCE_MS);
    };

    const resolveCurrentSelectionRect = (currentSelectionRect: CaptureRect) => {
        const currentPreciseRect = preciseRect();
        return currentPreciseRect && captureRectsMatch(preciseRectSource, currentSelectionRect)
            ? currentPreciseRect
            : currentSelectionRect;
    };

    return { invalidate, schedule, resolveCurrentSelectionRect };
}
