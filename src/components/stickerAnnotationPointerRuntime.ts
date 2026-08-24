import { createSignal } from "solid-js";

import type { StickerPoint } from "../types/stickerEditing";
import type { ActiveTransformInteraction } from "./stickerAnnotationTransformController";

// Keep non-rendering pointer-session state outside Solid's reactive graph. Only
// the active pointer id remains a signal so capture transitions stay explicit.
export const createStickerAnnotationPointerRuntime = () => {
    let hostRef: HTMLDivElement | undefined;
    let selectionOverlayRef: SVGGElement | undefined;
    let activePointerRect: DOMRect | null = null;
    let imperativeMovePoint: StickerPoint | null = null;
    let imperativeMoveFollowers: SVGGElement[] = [];
    let followerTransforms = new Map<SVGGElement, string | null>();
    let selectionOverlayTransform: string | null | undefined;
    const [activePointerId, setActivePointerId] = createSignal<number | null>(null);

    const host = () => hostRef;
    const setHostRef = (element: HTMLDivElement) => {
        hostRef = element;
    };
    const setSelectionOverlayRef = (element: SVGGElement) => {
        selectionOverlayRef = element;
    };

    const cacheHostBounds = () => {
        activePointerRect = hostRef?.getBoundingClientRect() ?? null;
    };
    const resetHostBounds = () => {
        activePointerRect = null;
    };
    const toLocalPoint = (event: PointerEvent): StickerPoint => {
        const rect = activePointerRect ?? hostRef?.getBoundingClientRect();
        const clientX = Number.isFinite(event.clientX) ? event.clientX : 0;
        const clientY = Number.isFinite(event.clientY) ? event.clientY : 0;
        if (!rect) return { x: clientX, y: clientY };
        return {
            x: clientX - (Number.isFinite(rect.left) ? rect.left : 0),
            y: clientY - (Number.isFinite(rect.top) ? rect.top : 0),
        };
    };

    const clearImperativeMovePreview = () => {
        for (const follower of imperativeMoveFollowers) {
            const previousTransform = followerTransforms.get(follower);
            if (previousTransform === null || previousTransform === undefined) {
                follower.removeAttribute("transform");
            } else {
                follower.setAttribute("transform", previousTransform);
            }
        }
        if (selectionOverlayRef && selectionOverlayTransform !== undefined) {
            if (selectionOverlayTransform === null) {
                selectionOverlayRef.removeAttribute("transform");
            } else {
                selectionOverlayRef.setAttribute("transform", selectionOverlayTransform);
            }
        }
        imperativeMoveFollowers = [];
        followerTransforms = new Map();
        selectionOverlayTransform = undefined;
        imperativeMovePoint = null;
    };

    const prepareImperativeMovePreview = (annotationIds: string[]) => {
        clearImperativeMovePreview();
        const selectedIds = new Set(annotationIds);
        imperativeMoveFollowers = Array.from(
            hostRef?.querySelectorAll<SVGGElement>("[data-sticker-annotation-id]") ?? [],
        ).filter((element) => selectedIds.has(element.dataset.stickerAnnotationId ?? ""));
        followerTransforms = new Map(
            imperativeMoveFollowers.map((element) => [element, element.getAttribute("transform")]),
        );
        selectionOverlayTransform = selectionOverlayRef?.getAttribute("transform") ?? null;
    };

    const applyImperativeMovePreview = (
        interaction: ActiveTransformInteraction,
        point: StickerPoint,
    ) => {
        imperativeMovePoint = point;
        const rawDeltaX = point.x - interaction.startPoint.x;
        const rawDeltaY = point.y - interaction.startPoint.y;
        const deltaX = interaction.axis === "y" ? 0 : rawDeltaX;
        const deltaY = interaction.axis === "x" ? 0 : rawDeltaY;
        const transform = `translate(${deltaX} ${deltaY})`;
        for (const follower of imperativeMoveFollowers) {
            follower.setAttribute("transform", transform);
        }
        selectionOverlayRef?.setAttribute("transform", transform);
    };

    const captureHostPointer = (pointerId: number) => {
        const target = hostRef;
        if (!target) return false;
        activePointerRect ??= target.getBoundingClientRect();
        try {
            target.setPointerCapture(pointerId);
        } catch {
            // Synthetic overlay-routed events may not own an OS pointer capture.
        }
        setActivePointerId(pointerId);
        return true;
    };

    const releaseHostPointer = () => {
        const pointerId = activePointerId();
        if (pointerId !== null) {
            try {
                if (hostRef?.hasPointerCapture(pointerId)) {
                    hostRef.releasePointerCapture(pointerId);
                }
            } catch {
                // The host may already be detached while component cleanup runs.
            } finally {
                setActivePointerId(null);
            }
        }
        resetHostBounds();
    };

    const dispose = () => {
        releaseHostPointer();
        clearImperativeMovePreview();
        hostRef = undefined;
        selectionOverlayRef = undefined;
    };

    return {
        applyImperativeMovePreview,
        cacheHostBounds,
        captureHostPointer,
        clearImperativeMovePreview,
        dispose,
        getImperativeMovePoint: () => imperativeMovePoint,
        host,
        prepareImperativeMovePreview,
        releaseHostPointer,
        resetHostBounds,
        setHostRef,
        setImperativeMovePoint: (point: StickerPoint | null) => {
            imperativeMovePoint = point;
        },
        setSelectionOverlayRef,
        toLocalPoint,
    };
};
