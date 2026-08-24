import { createMemo, createSignal, onCleanup, type Accessor } from "solid-js";

import { updateTextAnnotationById } from "../services/stickerAnnotationMutations";
import { stickerToolSettings, uiActions } from "../store/uiStore";
import type {
    StickerAnnotation,
    StickerAnnotationState,
    StickerPoint,
    StickerTextAnnotation,
} from "../types/stickerEditing";
import type { Unit } from "../types/unit";
import type { PendingTextInput } from "./stickerAnnotationModel";
import { sanitizeStrokeWidth, sanitizeTextSize } from "./stickerAnnotationNumericSafety";

interface PatchOptions {
    propagateEdit?: boolean;
    markLocalEdit?: boolean;
}

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
        options?: PatchOptions,
    ) => Promise<void>;
    rememberCurrentState: (includeImageData?: boolean) => void;
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
    onCleanup(clearPendingTextFocusTimer);

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
        const width = Math.max(160, options.width() - draft.x);
        const height = Math.max(24, draft.fontSize + 8);
        const left = Math.min(Math.max(0, draft.x), Math.max(0, options.width() - width));
        const top = Math.min(
            Math.max(0, draft.y - draft.fontSize),
            Math.max(0, options.height() - height),
        );
        return {
            left: `${left}px`,
            top: `${top}px`,
            width: `${width}px`,
            height: `${height}px`,
            color: "transparent",
            "caret-color": draft.color,
            "font-size": `${draft.fontSize}px`,
            "font-family": `"${draft.fontFamily}", "Segoe UI", ui-sans-serif, system-ui, sans-serif`,
            "font-weight": 500,
            "line-height": `${draft.fontSize}px`,
        };
    });

    const resolveTextAnnotationFontFamily = (annotation?: StickerTextAnnotation) =>
        annotation?.fontFamily ??
        (annotation?.type === "serial"
            ? stickerToolSettings.serialFontFamily
            : stickerToolSettings.textFontFamily);

    const beginPendingTextInput = (point: StickerPoint, existing?: StickerTextAnnotation) => {
        setPendingTextInput({
            annotationId: existing?.id,
            x: existing?.x ?? point.x,
            y: existing?.y ?? point.y,
            value: existing?.text ?? "",
            fontSize: sanitizeTextSize(existing?.fontSize ?? stickerToolSettings.textSize),
            color: existing?.style.color ?? stickerToolSettings.textColor,
            fontFamily: resolveTextAnnotationFontFamily(existing),
        });
        uiActions.setSelectedStickerAnnotation(existing?.id ?? null);
        clearPendingTextFocusTimer();
        pendingTextFocusTimer = setTimeout(() => {
            pendingTextFocusTimer = undefined;
            pendingTextInputRef?.focus();
            pendingTextInputRef?.select();
        }, 0);
    };

    const commitPendingTextInput = async () => {
        const draft = pendingTextInput();
        if (!draft) return;

        const text = draft.value.trim();
        setPendingTextInput(null);
        if (!text) return;

        if (draft.annotationId) {
            const existing = getPendingTextExistingAnnotation(draft);
            if (!existing || existing.text === text) {
                uiActions.setSelectedStickerAnnotation(draft.annotationId);
                return;
            }
            options.rememberCurrentState();
            await options.patchUnitData({
                annotationState: updateTextAnnotationById(
                    options.annotationState(),
                    draft.annotationId,
                    text,
                ),
            }, { propagateEdit: true });
            uiActions.setSelectedStickerAnnotation(draft.annotationId);
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
        await options.commitAnnotation(annotation);
        uiActions.setSelectedStickerAnnotation(annotation.id);
    };

    const handlePendingTextInputKeyDown = (
        event: KeyboardEvent & { currentTarget: HTMLInputElement },
    ) => {
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
        getPendingTextExistingAnnotation,
        handlePendingTextInputKeyDown,
        pendingTextInput,
        pendingTextInputStyle,
        resolveTextAnnotationFontFamily,
        setPendingTextInput,
        setPendingTextInputRef: (element: HTMLInputElement) => {
            pendingTextInputRef = element;
        },
    };
};
