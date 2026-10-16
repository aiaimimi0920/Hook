import { createComputed, createMemo, createSignal, onCleanup, type Accessor } from "solid-js";

import { updateTextAnnotationById } from "../services/stickerAnnotationMutations";
import { findTextCaretOffset } from "../services/stickerTextCaret";
import { measureTextWidth, getTextLineMetrics, TEXT_FRAME_PADDING } from "../services/stickerTextGeometry";
import { stickerToolSettings, uiActions } from "../../workspace/state/uiStore";
import type {
    StickerAnnotation,
    StickerAnnotationState,
    StickerPoint,
    StickerTextAnnotation,
} from "../types/stickerEditing";
import type { Unit } from "../../workspace/types/unit";
import type { PendingTextInput } from "./stickerAnnotationModel";
import { sanitizeStrokeWidth, sanitizeTextSize } from "./stickerAnnotationNumericSafety";

interface StickerAnnotationTextControllerOptions {
    width: Accessor<number>;
    height: Accessor<number>;
    annotationState: Accessor<StickerAnnotationState>;
    commitAnnotation: (
        annotation: StickerAnnotation,
        nextSerialCounter?: number,
    ) => Promise<void>;
    patchUnitData: (
        patch: Partial<Unit["data"]>,
    ) => Promise<void>;
    rememberCurrentState: (includeImageData?: boolean) => void;
    refreshOverlayInteractivity?: () => Promise<void>;
    restoreTextCursor?: () => Promise<void>;
}

// Own the inline text edit session while the layer retains rendering and
// pointer routing. Text commits still pass through the shared persistence owner.
export const createStickerAnnotationTextController = (
    options: StickerAnnotationTextControllerOptions,
) => {
    let pendingTextInputRef: HTMLInputElement | undefined;
    let pendingTextFocusTimer: ReturnType<typeof setTimeout> | undefined;
    const [pendingTextInput, setPendingTextInput] = createSignal<PendingTextInput | null>(null);

    const clearPendingTextFocusTimer = () => {
        if (pendingTextFocusTimer === undefined) return;
        clearTimeout(pendingTextFocusTimer);
        pendingTextFocusTimer = undefined;
    };
    const restoreTextCursor = async () => {
        try {
            await options.restoreTextCursor?.();
        } catch (error) {
            console.error("[Otter] Failed to restore cursor after text input", error);
        }
    };
    let editing = false;
    createComputed(() => {
        const active = pendingTextInput() !== null;
        if (editing && !active) {
            clearPendingTextFocusTimer();
            void restoreTextCursor();
        }
        editing = active;
    });
    onCleanup(() => {
        clearPendingTextFocusTimer();
        if (editing) void restoreTextCursor();
    });

    const getPendingTextExistingAnnotation = (draft: PendingTextInput) =>
        draft.annotationId
            ? options.annotationState().elements.find(
                  (annotation): annotation is StickerTextAnnotation =>
                      annotation.id === draft.annotationId &&
                      (annotation.type === "text" || annotation.type === "serial"),
              )
            : undefined;

    const pendingTextInputStyle = createMemo(() => {
        const draft = pendingTextInput();
        if (!draft) return {};
        // The transparent input and SVG preview must share the same origin.
        // Limit only empty space; capping typed content scrolls the caret away from the SVG.
        const contentWidth = measureTextWidth(draft.value, draft.fontSize, "500", draft.fontFamily);
        const line = getTextLineMetrics(draft.fontSize, draft.fontFamily);
        const padding = line.sidePadding;
        const left = draft.x - padding;
        const initialWidth = draft.annotationId ? 0
            : Math.min(Math.max(1, options.width() - left), draft.fontSize * 8 + padding * 2);
        const width = Math.max(initialWidth, contentWidth + padding * 2);
        const height = line.height;
        const top = draft.y - line.baselineOffset - height / 2;
        return {
            left: `${left}px`,
            top: `${top}px`,
            width: `${width}px`,
            height: `${height}px`,
            "box-sizing": "border-box" as const,
            padding: `${TEXT_FRAME_PADDING - 1}px ${padding - 1}px`,
            "text-align": "left" as const,
            color: "transparent",
            "caret-color": draft.color,
            "font-size": `${draft.fontSize}px`,
            "font-family": `"${draft.fontFamily}", "Segoe UI", ui-sans-serif, system-ui, sans-serif`,
            "font-weight": 500,
            "line-height": `${line.height - TEXT_FRAME_PADDING * 2}px`,
        };
    });

    const resolveTextAnnotationFontFamily = (annotation?: StickerTextAnnotation) =>
        annotation?.fontFamily ??
        (annotation?.type === "serial"
            ? stickerToolSettings.serialFontFamily
            : stickerToolSettings.textFontFamily);

    const refreshOverlayInteractivity = async () => {
        try {
            await options.refreshOverlayInteractivity?.();
        } catch (error) {
            console.error("[Otter] Failed to refresh overlay interactivity after text commit", error);
        } finally {
            // Persistence/rendering may complete after the input is removed.
            // Restore again here without ending a newer edit session.
            await restoreTextCursor();
        }
    };

    const beginPendingTextInput = (point: StickerPoint, existing?: StickerTextAnnotation) => {
        const fontSize = sanitizeTextSize(existing?.fontSize ?? stickerToolSettings.textSize);
        const fontFamily = resolveTextAnnotationFontFamily(existing);
        const line = getTextLineMetrics(fontSize, fontFamily);
        setPendingTextInput({
            annotationId: existing?.id,
            x: existing?.x ?? point.x + line.sidePadding,
            y: existing?.y ?? point.y + line.baselineOffset,
            value: existing?.text ?? "",
            fontSize,
            color: existing?.style.color ?? stickerToolSettings.textColor,
            fontFamily,
        });
        uiActions.setSelectedStickerAnnotation(existing?.id ?? null);
        const caret = existing
            ? findTextCaretOffset(existing.text, point.x - existing.x, fontSize, fontFamily) : 0;
        clearPendingTextFocusTimer();
        pendingTextFocusTimer = setTimeout(() => {
            pendingTextFocusTimer = undefined;
            pendingTextInputRef?.focus();
            pendingTextInputRef?.setSelectionRange(caret, caret);
        }, 0);
    };

    const commitPendingTextInput = async (selectCommitted = true) => {
        const draft = pendingTextInput();
        if (!draft) return;

        const text = draft.value.trim();
        setPendingTextInput(null);
        if (!text) {
            await refreshOverlayInteractivity();
            return;
        }

        if (draft.annotationId) {
            const existing = getPendingTextExistingAnnotation(draft);
            if (!existing || existing.text === text) {
                if (selectCommitted) uiActions.setSelectedStickerAnnotation(draft.annotationId);
                await refreshOverlayInteractivity();
                return;
            }
            options.rememberCurrentState();
            if (selectCommitted) uiActions.setSelectedStickerAnnotation(draft.annotationId);
            await options.patchUnitData({
                annotationState: updateTextAnnotationById(
                    options.annotationState(),
                    draft.annotationId,
                    text,
                ),
            });
            await refreshOverlayInteractivity();
            return;
        }

        const annotation: StickerTextAnnotation = {
            id: crypto.randomUUID(),
            type: "text",
            zIndex: options.annotationState().elements.length + 1,
            x: draft.x,
            y: draft.y,
            text,
            fontSize: draft.fontSize,
            fontFamily: draft.fontFamily,
            style: {
                color: draft.color,
                width: sanitizeStrokeWidth(stickerToolSettings.strokeWidth),
                opacity: 1,
            },
        };
        if (selectCommitted) uiActions.setSelectedStickerAnnotation(annotation.id);
        await options.commitAnnotation(annotation);
        await refreshOverlayInteractivity();
    };

    // Tool buttons can prevent the browser's default blur. Commit in capture
    // before their handlers cancel drafts, without taking selection back later.
    const commitOnExit = () => {
        void commitPendingTextInput(false).catch((error) => {
            console.error("[Otter] Failed to commit text on focus exit", error);
        });
    };
    const handleOutsideInput = (event: Event) => {
        if (pendingTextInput() && event.target !== pendingTextInputRef) commitOnExit();
    };
    if (typeof window !== "undefined") {
        window.addEventListener("pointerdown", handleOutsideInput, true);
        window.addEventListener("focusin", handleOutsideInput, true);
        window.addEventListener("blur", commitOnExit);
        onCleanup(() => {
            window.removeEventListener("pointerdown", handleOutsideInput, true);
            window.removeEventListener("focusin", handleOutsideInput, true);
            window.removeEventListener("blur", commitOnExit);
        });
    }

    const handlePendingTextInputKeyDown = (
        event: KeyboardEvent & { currentTarget: HTMLInputElement },
    ) => {
        if (event.isComposing || event.keyCode === 229) return;
        if (event.key === "Enter") {
            event.preventDefault();
            void commitPendingTextInput();
        }
        if (event.key === "Escape") {
            event.preventDefault();
            setPendingTextInput(null);
        }
    };

    return {
        beginPendingTextInput,
        commitPendingTextInput,
        commitOnExit,
        getPendingTextExistingAnnotation,
        handlePendingTextInputKeyDown,
        pendingTextInput,
        pendingTextInputStyle,
        setPendingTextInput,
        setPendingTextInputRef: (element: HTMLInputElement) => {
            pendingTextInputRef = element;
        },
    };
};
