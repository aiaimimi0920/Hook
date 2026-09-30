import { unwrap } from "solid-js/store";

import { graphStore } from "../store/graphStore";
import type { ExtensionTarget } from "./extensionBridgeProtocol";
import { extensionRegistry } from "./extensionRegistry";
import { extensionVisualRegistry } from "./extensionVisualRegistry";
import { unitExtensionVisuals, visualSourceIsCurrent } from "./extensionVisualSources";
import { syncService } from "./syncService";

export const OCR_RECOGNIZE_COMMAND = "neuro.official/ocr.recognize-selected-unit";

/** First-use routing belongs to the host's named OCR text context contract. */
export const cachedOverlayCommand = (commandId: string) => {
    if (commandId === "neuro.official/ocr.toggle-overlay") return {
        typeIds: ["neuro.official/ocr.result.v1", "neuro.official/ocr.codes.v1"],
        fallbackCommand: OCR_RECOGNIZE_COMMAND,
    };
    if (commandId === "neuro.official/text-translation.toggle-overlay") return {
        typeIds: ["neuro.official/text-translation.result.v1"],
        fallbackCommand: "neuro.official/text-translation.translate",
    };
    return undefined;
};

const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Changes presentation only. A real result refresh still replaces the attachment through CAS. */
export const toggleCachedUnitOverlay = (
    scopeId: string,
    target: ExtensionTarget,
    typeIds: readonly string[],
): boolean => {
    const plugin = extensionRegistry.snapshot()?.plugins.find((item) => item.scopeId === scopeId);
    if (!plugin || !["trusted", "unsigned_developer"].includes(plugin.trustStatus)) {
        throw new Error("extension overlay owner is not active");
    }
    const unit = graphStore.units.find((item) => item.id === target.unitId);
    if (!unit || (unit.data.stickerEditPropagation?.revision ?? 0) !== target.revision) {
        throw new Error("extension overlay target is stale");
    }
    const state = unit.data.extensionState;
    if (!state) return false;
    const cached = state.attachments.filter((attachment) => {
        if (attachment.pluginId !== plugin.id || !typeIds.includes(attachment.typeId)) return false;
        const renderer = extensionVisualRegistry.rendererFor(attachment);
        return !renderer || visualSourceIsCurrent(unit, attachment, renderer);
    });
    if (cached.length === 0) return false;
    const ids = new Set(cached.map((attachment) => attachment.attachmentId));
    const visible = !unitExtensionVisuals(unit).some(({ attachment }) => ids.has(attachment.attachmentId));
    const replacements = new Set(state.attachments.filter((attachment) => {
        const renderer = extensionVisualRegistry.rendererFor(attachment);
        const source = record(record(attachment.payload).sourceAttachment);
        return renderer?.replacesSource && renderer.sourceContext === "ocr-text.v1"
            && typeof source.attachmentId === "string" && ids.has(source.attachmentId);
    }).map((attachment) => attachment.attachmentId));

    // Showing the source dismisses its replacement; showing a replacement
    // merely suppresses the source, retaining the user's source visibility intent.
    graphStore.actions.updateUnitData(unit.id, {
        extensionState: {
            ...unwrap(state),
            revision: state.revision + 1,
            attachments: state.attachments.map((attachment) => ids.has(attachment.attachmentId)
                ? { ...unwrap(attachment), overlayVisible: visible }
                : visible && replacements.has(attachment.attachmentId)
                    ? { ...unwrap(attachment), overlayVisible: false }
                    : unwrap(attachment)),
        },
    });
    void syncService.performWorkflowSync();
    return true;
};
