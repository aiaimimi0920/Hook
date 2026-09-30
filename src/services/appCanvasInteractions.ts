import { batch } from "solid-js";

import { graphStore } from "../store/graphStore";
import {
    activeStickerEditTargetId,
    draggingStickerId,
    isSelecting,
    selectedUnitIds,
    selectionActions,
    setLinkingState,
    setMousePos,
    setSelectedStickerId,
    uiActions,
} from "../store/uiStore";
import { api } from "./api";
import { shouldStartCanvasSelectionFromTarget } from "./captureState";
import { resolveCanvasDisplayImage } from "./graphImageResolution";
import type { OverlaySyntheticDispatcher } from "./overlaySyntheticEvents";
import { shouldResetOverlaySyntheticOnGlobalMouseUp } from "./overlaySyntheticEvents";

type AppCanvasInteractionDependencies = {
    tauriRuntime: boolean;
    overlaySynthetic: OverlaySyntheticDispatcher;
    checkDragModifier: (event: MouseEvent, action: "dragOut") => boolean;
    handleDragMove: (event: MouseEvent) => void;
    handleDragEnd: () => void;
    handleSelectionStart: (event: MouseEvent) => void;
    handleSelectionMove: (event: MouseEvent) => void;
    handleSelectionEnd: (event: MouseEvent) => void;
    resetSelection: () => void;
    startDrag: (
        event: MouseEvent,
        unitId: string,
        onClick: (clickedId: string) => void,
    ) => void;
};

/** Owns canvas-global pointer routing and unit drag-start behavior. */
export function createAppCanvasInteractions({
    tauriRuntime,
    overlaySynthetic,
    checkDragModifier,
    handleDragMove,
    handleDragEnd,
    handleSelectionStart,
    handleSelectionMove,
    handleSelectionEnd,
    resetSelection,
    startDrag,
}: AppCanvasInteractionDependencies) {
    const handledGlobalMouseMoveEvents = new WeakSet<Event>();
    const handledGlobalMouseUpEvents = new WeakSet<Event>();

    const handleGlobalMouseMove = (event: MouseEvent) => {
        if (handledGlobalMouseMoveEvents.has(event)) return;
        handledGlobalMouseMoveEvents.add(event);
        if (tauriRuntime && draggingStickerId() && event.isTrusted) return;
        // Native overlay selection is already updated before its untrusted DOM
        // replay bubbles here. Do not reinterpret that replay as sticker drag.
        if (!event.isTrusted && overlaySynthetic.textSelectionActive) return;
        if (!draggingStickerId()) {
            setMousePos({ x: event.clientX, y: event.clientY });
        }
        if (!overlaySynthetic.moveRelayActive && !draggingStickerId()) {
            overlaySynthetic.relayPointerMove(event);
        }
        handleDragMove(event);
        if (!tauriRuntime || !isSelecting()) handleSelectionMove(event);
    };

    const handleGlobalMouseUp = (event: MouseEvent) => {
        if (handledGlobalMouseUpEvents.has(event)) return;
        handledGlobalMouseUpEvents.add(event);
        if (tauriRuntime && draggingStickerId() && event.isTrusted) return;
        handleDragMove(event);
        handleDragEnd();
        if (!tauriRuntime || !isSelecting()) handleSelectionEnd(event);
        if (shouldResetOverlaySyntheticOnGlobalMouseUp(tauriRuntime, event.isTrusted)) {
            overlaySynthetic.reset();
        }
        setLinkingState((previous) => ({ ...previous, isLinking: false }));
    };

    const handleGlobalMouseDown = (event: MouseEvent) => {
        if (isSelecting()) {
            if (tauriRuntime) return;
            handleSelectionStart(event);
            return;
        }
        if (!shouldStartCanvasSelectionFromTarget(event.target)) return;
        if (!event.shiftKey && !event.ctrlKey) {
            setSelectedStickerId(null);
            resetSelection();
            uiActions.hideStickerToolbar();
        }
        if (!checkDragModifier(event, "dragOut")) handleSelectionStart(event);
    };

    const onStartDragUnit = (event: MouseEvent, id: string) => {
        if (checkDragModifier(event, "dragOut")) return;
        event.stopPropagation();
        event.preventDefault();
        if (isSelecting()) {
            handleSelectionStart(event);
            return;
        }

        const wasSelected = selectedUnitIds.includes(id);
        const targetUnit = graphStore.units.find((unit) => unit.id === id);
        const targetGroup = targetUnit?.data.groupId
            ? graphStore.stickerGroups.find((group) => group.id === targetUnit.data.groupId)
            : undefined;
        const activeEditTarget = activeStickerEditTargetId();
        if (activeEditTarget && activeEditTarget !== id) uiActions.hideStickerToolbar();
        if (targetGroup?.locked) return;
        void api.focusOverlayWindow();

        batch(() => {
            if (event.ctrlKey) {
                if (!wasSelected) selectionActions.add(id);
            } else if (!wasSelected) {
                selectionActions.set([id]);
            }
            startDrag(event, id, (clickedId) => {
                const clickedUnit = graphStore.units.find((unit) => unit.id === clickedId);
                if (clickedUnit?.type !== "sticker" || activeStickerEditTargetId() !== clickedId) {
                    uiActions.hideStickerToolbar();
                }
                if (event.ctrlKey) {
                    if (wasSelected) selectionActions.toggle(clickedId);
                } else {
                    selectionActions.set([clickedId]);
                }
            });
        });
    };

    const resolveUnitImage = (id: string): string | undefined =>
        resolveCanvasDisplayImage({
            units: graphStore.units,
            links: graphStore.links,
            unitId: id,
        });

    return {
        handleGlobalMouseDown,
        handleGlobalMouseMove,
        handleGlobalMouseUp,
        onStartDragUnit,
        resolveUnitImage,
    };
}
