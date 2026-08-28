import { api } from "../services/api";
import { logger } from "../services/logger";
import { cleanupCaptureInput } from "../services/captureInputCleanup";

import {
    isSelecting, setIsSelecting,
    isBoxSelecting, setIsBoxSelecting,
    startPos, setStartPos,
    selectionRect, setSelectionRect,
    selectionActions,
    captureMode,
    setCaptureMode,
} from "../store/uiStore";
import { createAutoLongCaptureController } from "./autoLongCaptureController";
import { addCaptureUnit, restorePostCaptureInteractivity } from "./captureUnitController";
import { createPreciseSelectionController } from "./preciseSelectionController";

import { graphStore } from "../store/graphStore";
import { syncService } from "../services/syncService";
import {
    CaptureWindowClickState,
    CaptureWindowTarget,
    isLongCaptureMode,
    findCaptureWindowTargetAtPoint,
    findRefreshedCaptureWindowTarget,
    shouldConfirmCaptureWindowDoubleClick,
} from "../services/captureState";

let cachedUnitRects: {id: string, x: number, y: number, w: number, h: number}[] = [];

export function useSelection(onCaptureHoverClear: () => void = () => {}) {
    let captureSessionGeneration = 0;
    let pendingCaptureTimer: number | null = null;
    let captureWindowTargets: CaptureWindowTarget[] = [];
    let captureWindowTargetLoadGeneration = 0;
    let hoveredCaptureWindowTargetId: string | null = null;
    let pressedCaptureWindowTarget: CaptureWindowTarget | null = null;
    let lastCaptureWindowClick: CaptureWindowClickState | null = null;

    const preciseSelection = createPreciseSelectionController({
        getCaptureSessionGeneration: () => captureSessionGeneration,
        isCaptureSessionCurrent: (generation) => generation === captureSessionGeneration,
    });

    const resetSelection = () => {
        preciseSelection.invalidate();
        setStartPos(null);
        setSelectionRect(null);
        setIsSelecting(false);
        setIsBoxSelecting(false);
        setCaptureMode("region");
        cachedUnitRects = [];
        captureWindowTargetLoadGeneration += 1;
        captureWindowTargets = [];
        hoveredCaptureWindowTargetId = null;
        pressedCaptureWindowTarget = null;
        lastCaptureWindowClick = null;
    };

    const cleanupCaptureSession = (reason: string, restoreMouseMonitor: boolean) =>
        cleanupCaptureInput({
            reason,
            setCaptureInputInactive: () => api.setCaptureInputActive(false),
            clearHover: onCaptureHoverClear,
            resetSelection,
            setOverlayClickThrough: () => api.setOverlayClickThrough(true),
            restoreMouseMonitor,
            setMouseMonitorActive: () => api.setMouseMonitorActive(true),
            updateBackendRects: () => syncService.updateBackendRects(),
        });

    const updateCaptureWindowHover = (x: number, y: number) => {
        if (!isSelecting() || captureMode() !== "region" || startPos()) return;
        const target = findCaptureWindowTargetAtPoint(captureWindowTargets, x, y);
        if (target?.id === hoveredCaptureWindowTargetId) return;
        hoveredCaptureWindowTargetId = target?.id ?? null;
        setSelectionRect(target ? { x: target.x, y: target.y, w: target.w, h: target.h } : null);
    };

    const prepareCaptureWindowTargets = async (initialPoint?: { x: number; y: number } | null) => {
        captureWindowTargetLoadGeneration += 1;
        const loadGeneration = captureWindowTargetLoadGeneration;
        const sessionGeneration = captureSessionGeneration;
        if (captureMode() !== "region") {
            captureWindowTargets = [];
            return;
        }

        try {
            const targets = await api.listCaptureWindowTargets();
            if (
                loadGeneration !== captureWindowTargetLoadGeneration
                || !isCaptureSessionCurrent(sessionGeneration)
                || !isSelecting()
                || captureMode() !== "region"
            ) {
                return;
            }
            captureWindowTargets = targets;
            if (initialPoint) {
                updateCaptureWindowHover(initialPoint.x, initialPoint.y);
            }
            void api.debugLogEvent("capture-window-targets-ready", `count=${targets.length}`);
        } catch (error) {
            if (loadGeneration === captureWindowTargetLoadGeneration) {
                captureWindowTargets = [];
            }
            void api.debugLogEvent(
                "capture-window-targets-failed",
                error instanceof Error ? error.message : String(error),
            );
        }
    };

    const refreshCaptureWindowTargetForClick = async (
        targetId: string,
        point: { x: number; y: number },
        sessionGeneration: number,
    ): Promise<CaptureWindowTarget | null> => {
        captureWindowTargetLoadGeneration += 1;
        const loadGeneration = captureWindowTargetLoadGeneration;
        try {
            const targets = await api.listCaptureWindowTargets();
            if (
                loadGeneration !== captureWindowTargetLoadGeneration
                || !isCaptureSessionCurrent(sessionGeneration)
                || !isSelecting()
                || captureMode() !== "region"
            ) {
                return null;
            }
            captureWindowTargets = targets;
            const refreshedTarget = findRefreshedCaptureWindowTarget(
                targets,
                targetId,
                point.x,
                point.y,
            );
            void api.debugLogEvent(
                refreshedTarget
                    ? "capture-window-target-refreshed"
                    : "capture-window-target-refresh-rejected",
                `target=${targetId} count=${targets.length}`,
            );
            return refreshedTarget;
        } catch (error) {
            if (loadGeneration === captureWindowTargetLoadGeneration) {
                captureWindowTargets = [];
            }
            void api.debugLogEvent(
                "capture-window-target-refresh-failed",
                error instanceof Error ? error.message : String(error),
            );
            return null;
        }
    };

    const clearPendingCaptureTimer = () => {
        if (pendingCaptureTimer !== null) {
            window.clearTimeout(pendingCaptureTimer);
            pendingCaptureTimer = null;
        }
    };

    const beginCaptureSessionLifecycle = () => {
        clearPendingCaptureTimer();
        captureSessionGeneration += 1;
        return captureSessionGeneration;
    };

    const invalidateCaptureSessionLifecycle = () => {
        clearPendingCaptureTimer();
        captureSessionGeneration += 1;
        preciseSelection.invalidate();
    };

    const isCaptureSessionCurrent = (generation: number) =>
        generation === captureSessionGeneration;

    const {
        startAutoLongCaptureSession,
        finishAutoLongCaptureSession,
        cancelAutoLongCaptureSession,
        notifyAutoLongCaptureWheel,
    } = createAutoLongCaptureController({
        resetSelection,
        restorePostCaptureInteractivity,
        addCaptureUnit,
        clearCaptureHover: onCaptureHoverClear,
    });

    const handleSelectionStart = (e: Pick<MouseEvent, "clientX" | "clientY" | "shiftKey" | "ctrlKey">) => {
         // Mode 1: Capture (Explicitly triggered)
         if (isSelecting()) {
             void api.debugLogEvent("selection-start", `x=${e.clientX} y=${e.clientY}`);
             pressedCaptureWindowTarget = captureMode() === "region"
                 ? findCaptureWindowTargetAtPoint(captureWindowTargets, e.clientX, e.clientY)
                 : null;
             setStartPos({ x: e.clientX, y: e.clientY });
             setSelectionRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 });
             return;
         }

         // Mode 2: Box Selection (Implicit)
         setIsBoxSelecting(true);
         setStartPos({ x: e.clientX, y: e.clientY });
         setSelectionRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 });

         // Clear selection if not modified
         if (!e.shiftKey && !e.ctrlKey) {
             selectionActions.clear();
         }

         // Cache Geometry
         cachedUnitRects = graphStore.units.map(u => ({
             id: u.id, x: u.x, y: u.y, w: u.w, h: u.h
         }));
    };

    const handleSelectionMove = (e: Pick<MouseEvent, "clientX" | "clientY" | "shiftKey" | "ctrlKey">) => {
        const start = startPos();
        if (isSelecting() && !start) {
            updateCaptureWindowHover(e.clientX, e.clientY);
            return;
        }
        if ((!isSelecting() && !isBoxSelecting()) || !start) return;


        const current = { x: e.clientX, y: e.clientY };

        // Determine direction
        const isLeft = current.x < start.x;
        const isUp = current.y < start.y;

        const w = Math.abs(start.x - current.x);
        const h = Math.abs(start.y - current.y);

        let snappedW = w;
        let snappedH = h;

        // === CAPTURE MODE VISUALS ===
        if (isSelecting()) {
            // Shift-Snap (10px increments)
            if (e.shiftKey) {
                snappedW = Math.round(w / 10) * 10;
                snappedH = Math.round(h / 10) * 10;
            }
        }

        const x = isLeft ? start.x - snappedW : start.x;
        const y = isUp ? start.y - snappedH : start.y;
        const nextSelectionRect = { x, y, w: snappedW, h: snappedH };

        setSelectionRect(nextSelectionRect);

        // Ctrl precise matching is intentionally idle-debounced. Ctrl+1 leaves
        // Ctrl pressed for a short time after capture starts, and UIAutomation
        // responses can arrive out of order. Never let an old precise result
        // replace the live pointer rectangle.
        if (e.ctrlKey && isSelecting() && snappedW > 0 && snappedH > 0) {
            preciseSelection.schedule(nextSelectionRect);
        } else {
            preciseSelection.invalidate();
        }

        // === BOX SELECTION LOGIC ===
        if (isBoxSelecting()) {
             const selX = x;
             const selY = y;
             const selR = x + snappedW;
             const selB = y + snappedH;

             const newSelection: string[] = [];

             // Iterate cached rects for performance
             for (const u of cachedUnitRects) {
                 const uR = u.x + u.w;
                 const uB = u.y + u.h;
                 // AABB Intersection check
                 const intersects = !(selR < u.x || selX > uR || selB < u.y || selY > uB);
                 if (intersects) {
                     newSelection.push(u.id);
                 }
             }

             // Apply Selection
             // TODO: Shift key for "Additive" selection?
             // For now, simple replacement match standard behavior
             if (e.shiftKey) {
                 // Additive Logic (Union with what?)
                 // If we cached 'initialSelection', we could do Union(initial, new).
                 // Without cache, it's tricky.
                 // Let's just do simple set for now.
                 selectionActions.set(newSelection);
             } else {
                 selectionActions.set(newSelection);
             }
        }
    };

    const handleSelectionEnd = async (event?: Pick<MouseEvent, "clientX" | "clientY" | "shiftKey" | "ctrlKey">) => {
        if (event && isSelecting() && startPos()) {
            handleSelectionMove(event);
        }

        if (isBoxSelecting()) {
            setIsBoxSelecting(false);
            setSelectionRect(null);
            setStartPos(null);
            cachedUnitRects = [];
            return;
        }

        if (!isSelecting() || !selectionRect()) return;

        // Import check (handled by import in store/uiStore)
        // Need to import isCropping, selectedStickerId at top of file, or use accessor if available
        // Assuming they are imported below in the full file update
        const currentSelectionRect = selectionRect()!;
        const rect = preciseSelection.resolveCurrentSelectionRect(currentSelectionRect);
        let resolvedCaptureRect = rect;
        let confirmedCaptureWindowTargetId: string | null = null;
        let captureWindowSurfaceTargetId: string | null = null;
        preciseSelection.invalidate();
        const sessionGeneration = captureSessionGeneration;

        const releasedCaptureWindowTarget = event && captureMode() === "region"
            ? findCaptureWindowTargetAtPoint(captureWindowTargets, event.clientX, event.clientY)
            : null;
        let clickedCaptureWindowTarget = resolvedCaptureRect.w < 5
            && resolvedCaptureRect.h < 5
            && pressedCaptureWindowTarget
            && releasedCaptureWindowTarget?.id === pressedCaptureWindowTarget.id
            ? releasedCaptureWindowTarget
            : null;
        pressedCaptureWindowTarget = null;
        if (clickedCaptureWindowTarget) {
            const clickPoint = {
                x: event?.clientX ?? resolvedCaptureRect.x,
                y: event?.clientY ?? resolvedCaptureRect.y,
            };
            const now = Date.now();
            if (!shouldConfirmCaptureWindowDoubleClick(
                lastCaptureWindowClick,
                clickedCaptureWindowTarget.id,
                now,
            )) {
                lastCaptureWindowClick = { targetId: clickedCaptureWindowTarget.id, at: now };
                hoveredCaptureWindowTargetId = clickedCaptureWindowTarget.id;
                setStartPos(null);
                setSelectionRect({
                    x: clickedCaptureWindowTarget.x,
                    y: clickedCaptureWindowTarget.y,
                    w: clickedCaptureWindowTarget.w,
                    h: clickedCaptureWindowTarget.h,
                });
                void api.debugLogEvent(
                    "capture-window-click-armed",
                    `target=${clickedCaptureWindowTarget.id}`,
                );
                void prepareCaptureWindowTargets(clickPoint);
                return;
            }

            clickedCaptureWindowTarget = await refreshCaptureWindowTargetForClick(
                clickedCaptureWindowTarget.id,
                clickPoint,
                sessionGeneration,
            );
            if (!isCaptureSessionCurrent(sessionGeneration)) return;
            if (!clickedCaptureWindowTarget) {
                lastCaptureWindowClick = null;
                setStartPos(null);
                hoveredCaptureWindowTargetId = null;
                setSelectionRect(null);
                updateCaptureWindowHover(clickPoint.x, clickPoint.y);
                return;
            }

            lastCaptureWindowClick = null;
            confirmedCaptureWindowTargetId = clickedCaptureWindowTarget.id;
            captureWindowSurfaceTargetId = clickedCaptureWindowTarget.id;
            resolvedCaptureRect = {
                x: clickedCaptureWindowTarget.x,
                y: clickedCaptureWindowTarget.y,
                w: clickedCaptureWindowTarget.w,
                h: clickedCaptureWindowTarget.h,
            };
            setSelectionRect(resolvedCaptureRect);
            void api.debugLogEvent(
                "capture-window-double-click-confirmed",
                `target=${clickedCaptureWindowTarget.id}`,
            );
        }

        if (resolvedCaptureRect.w < 5 || resolvedCaptureRect.h < 5) {
            if (!isCaptureSessionCurrent(sessionGeneration)) {
                void api.debugLogEvent("selection-end-small-stale", `generation=${sessionGeneration}`);
                return;
            }
            void api.debugLogEvent(
                "selection-end-small",
                `w=${resolvedCaptureRect.w} h=${resolvedCaptureRect.h}`,
            );
            await cleanupCaptureSession("small-selection", graphStore.units.length > 0);
            return;
        }

        // CAPTURE
        const activeCaptureMode = captureMode();
        const isLongCapture = isLongCaptureMode(activeCaptureMode);
        setIsSelecting(false);
        if (!isCaptureSessionCurrent(sessionGeneration)) {
            void api.debugLogEvent("selection-end-stale", `generation=${sessionGeneration}`);
            return;
        }
        void api.debugLogEvent(
            "selection-end",
            `x=${resolvedCaptureRect.x} y=${resolvedCaptureRect.y} w=${resolvedCaptureRect.w} h=${resolvedCaptureRect.h}`,
        );

        let startX = resolvedCaptureRect.x;
        let startY = resolvedCaptureRect.y;

        // Wait for UI repaint (remove grey box)
        pendingCaptureTimer = window.setTimeout(async () => {
            pendingCaptureTimer = null;
            if (!isCaptureSessionCurrent(sessionGeneration)) {
                void api.debugLogEvent("selection-capture-timer-stale", `generation=${sessionGeneration}`);
                return;
            }

            logger.debug("[Selection] Executing Capture for rect:", resolvedCaptureRect);
            try {
                if (confirmedCaptureWindowTargetId) {
                    const finalTargets = await api.listCaptureWindowTargets();
                    if (!isCaptureSessionCurrent(sessionGeneration)) return;
                    const finalTarget = finalTargets.find(
                        (target) => target.id === confirmedCaptureWindowTargetId,
                    );
                    if (!finalTarget) {
                        throw new Error("The selected window is no longer visible on this display");
                    }
                    resolvedCaptureRect = {
                        x: finalTarget.x,
                        y: finalTarget.y,
                        w: finalTarget.w,
                        h: finalTarget.h,
                    };
                    startX = finalTarget.x;
                    startY = finalTarget.y;
                    await api.debugLogEvent(
                        "capture-window-target-finalized",
                        `target=${finalTarget.id} x=${finalTarget.x} y=${finalTarget.y} w=${finalTarget.w} h=${finalTarget.h}`,
                    );
                }
                await api.debugLogEvent(
                    "selection-capture-request",
                    `x=${resolvedCaptureRect.x} y=${resolvedCaptureRect.y} w=${resolvedCaptureRect.w} h=${resolvedCaptureRect.h}`,
                );
                if (!isCaptureSessionCurrent(sessionGeneration)) return;
                if (isLongCapture) {
                    await api.debugLogEvent("selection-long-capture-prepare");
                    if (!isCaptureSessionCurrent(sessionGeneration)) return;
                    await startAutoLongCaptureSession(resolvedCaptureRect, { x: startX, y: startY });
                    return;
                }

                logger.debug("Requesting Capture:", resolvedCaptureRect);
                const response = await api.captureRegion(
                    Math.round(resolvedCaptureRect.x),
                    Math.round(resolvedCaptureRect.y),
                    Math.round(resolvedCaptureRect.w),
                    Math.round(resolvedCaptureRect.h),
                    captureWindowSurfaceTargetId
                        ? { captureWindowId: captureWindowSurfaceTargetId }
                        : undefined,
                );
                if (!isCaptureSessionCurrent(sessionGeneration)) {
                    await api.debugLogEvent("selection-capture-response-stale", `generation=${sessionGeneration}`);
                    return;
                }
                await addCaptureUnit(
                    response,
                    resolvedCaptureRect,
                    { x: startX, y: startY },
                    activeCaptureMode,
                );

            } catch (e) {
                console.error("Capture Failed", e);
                void api.debugLogEvent("selection-capture-failure", e instanceof Error ? e.message : String(e));
                if (isLongCapture && isCaptureSessionCurrent(sessionGeneration)) {
                    await cleanupCaptureSession("long-capture-failed", graphStore.units.length > 0);
                }
            } finally {
                if (!isLongCapture && isCaptureSessionCurrent(sessionGeneration)) {
                    // Keep the native hook swallowing moves until the bitmap
                    // request above has settled; otherwise the release point
                    // can trigger a new external hover before capture completes.
                    await cleanupCaptureSession("capture-finished", true);
                }
            }
        }, 50);

    };


    return {
        handleSelectionStart,
        handleSelectionMove,
        handleSelectionEnd,
        resetSelection,
        beginCaptureSessionLifecycle,
        invalidateCaptureSessionLifecycle,
        finishAutoLongCaptureSession,
        cancelAutoLongCaptureSession,
        notifyAutoLongCaptureWheel,
        prepareCaptureWindowTargets,
    };
}
