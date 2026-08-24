import { createEffect, onCleanup, type Setter } from "solid-js";

import { acceptsSurfaceRelayedKeydown } from "../services/surfaceHostKeydown";
import { stickerEditCancelToken } from "../store/uiStore";
import type {
    DraftLine,
    DraftShape,
    PendingTextInput,
} from "./stickerAnnotationModel";
import type {
    ReshapeLineState,
    ResizeAnnotationState,
} from "./stickerAnnotationTransformController";

interface StickerAnnotationLifecycleOptions {
    setCtrlPressed: Setter<boolean>;
    setShiftPressed: Setter<boolean>;
    setAltPressed: Setter<boolean>;
    setDraftShape: Setter<DraftShape | null>;
    setDraftLine: Setter<DraftLine | null>;
    setResizeAnnotation: Setter<ResizeAnnotationState | null>;
    setReshapeLine: Setter<ReshapeLineState | null>;
    setPendingTextInput: Setter<PendingTextInput | null>;
    finishActiveLiveErase: () => Promise<unknown>;
    resetHostBounds: () => void;
    disposeWheelController: () => void;
    disposePointerRuntime: () => void;
}

// Own window-scoped listeners and cancellation cleanup so the visual layer only
// wires controllers to SVG elements. Solid disposes both effects with the layer.
export const createStickerAnnotationLifecycleController = (
    options: StickerAnnotationLifecycleOptions,
) => {
    createEffect(() => {
        stickerEditCancelToken();
        void options.finishActiveLiveErase().catch((error) => {
            console.warn("[Hook] Failed to finish live erase while cancelling sticker edit", error);
        });
        options.setDraftShape(null);
        options.setDraftLine(null);
        options.setResizeAnnotation(null);
        options.setReshapeLine(null);
        options.setPendingTextInput(null);
    });

    createEffect(() => {
        const setModifier = (event: KeyboardEvent, pressed: boolean) => {
            if (event.key === "Control") options.setCtrlPressed(pressed);
            if (event.key === "Shift") options.setShiftPressed(pressed);
            if (event.key === "Alt") options.setAltPressed(pressed);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            // A drag that stays over a JavaScript Surface receives relayed modifier
            // events; reject all other untrusted cross-surface keydown events.
            if (!acceptsSurfaceRelayedKeydown(event, { surfaceRelayed: true })) return;
            setModifier(event, true);
        };
        const handleKeyUp = (event: KeyboardEvent) => setModifier(event, false);
        const handleBlur = () => {
            options.setCtrlPressed(false);
            options.setShiftPressed(false);
            options.setAltPressed(false);
        };
        const handleViewportGeometryChange = () => options.resetHostBounds();

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        window.addEventListener("blur", handleBlur);
        window.addEventListener("resize", handleViewportGeometryChange);
        window.addEventListener("scroll", handleViewportGeometryChange, true);

        onCleanup(() => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
            window.removeEventListener("blur", handleBlur);
            window.removeEventListener("resize", handleViewportGeometryChange);
            window.removeEventListener("scroll", handleViewportGeometryChange, true);
            options.disposeWheelController();
            options.disposePointerRuntime();
        });
    });
};
