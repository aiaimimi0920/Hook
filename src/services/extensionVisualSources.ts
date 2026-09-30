import type { Unit } from "../types/unit";
import type { UnitAttachment } from "../types/unitExtension";
import { extensionVisualRegistry, type ExtensionVisualDescriptor } from "./extensionVisualRegistry";

const OCR_PLUGIN_ID = "neuro.official/ocr";
const OCR_RESULT_TYPE_ID = "neuro.official/ocr.result.v1";
const OCR_RENDERER_ID = "neuro.official/ocr.result-overlay";
const OCR_COPY_BLOCK_COMMAND = "neuro.official/ocr.copy-block";

const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const attachmentVisible = (attachment: UnitAttachment): boolean =>
    attachment.overlayVisible ?? record(attachment.payload).visible !== false;

/**
 * Older Loom snapshots may expose the OCR data type before its renderer is
 * refreshed. Keep the already validated attachment usable during that brief
 * transition instead of silently dropping the text overlay.
 */
const ocrRendererFallback = (unit: Unit, attachment: UnitAttachment): ExtensionVisualDescriptor | null => {
    if (attachment.pluginId !== OCR_PLUGIN_ID || attachment.typeId !== OCR_RESULT_TYPE_ID
        || extensionVisualRegistry.rendererFor(attachment)) return null;
    const state = extensionVisualRegistry.state();
    if (!state.activePluginIds.has(OCR_PLUGIN_ID) || !state.dataTypeIds.has(OCR_RESULT_TYPE_ID)) return null;
    const payload = record(attachment.payload);
    if (!payload.surfaceScene || typeof payload.surfaceScene !== "object") return null;
    return {
        id: OCR_RENDERER_ID,
        kind: "renderer",
        pluginId: OCR_PLUGIN_ID,
        pluginVersion: attachment.pluginVersion,
        scopeId: "ocr-renderer-fallback",
        typeId: OCR_RESULT_TYPE_ID,
        commandId: OCR_COPY_BLOCK_COMMAND,
        bounds: { x: 0, y: 0, width: Math.max(1, unit.w), height: Math.max(1, unit.h) },
        attachmentScenePath: ["surfaceScene"],
        generation: 0,
    };
};

/** Source guards are named contracts, not arbitrary foreign attachment access. */
export const visualSourceIsCurrent = (
    unit: Unit,
    attachment: UnitAttachment,
    descriptor: ExtensionVisualDescriptor,
): boolean => {
    if (!descriptor.sourceContext) return true;
    const payload = record(attachment.payload);
    const dependency = record(payload.sourceAttachment);
    const source = unit.data.extensionState?.attachments.find((item) =>
        item.attachmentId === "neuro.official/ocr.result"
        && item.pluginId === "neuro.official/ocr" && item.typeId === "neuro.official/ocr.result.v1"
        && item.schemaVersion === "1");
    return payload.sourceRevision === (unit.data.stickerEditPropagation?.revision ?? 0)
        && dependency.attachmentId === source?.attachmentId
        && Boolean(source) && dependency.revision === source?.revision
        && dependency.digest === source?.payloadDigest
        && payload.originalText === record(source?.payload).fullText;
};

export const unitExtensionVisuals = (unit: Unit) => {
    const attachments = unit.data.extensionState?.attachments ?? [];
    const candidates = attachments.flatMap((attachment) => {
        const renderer = extensionVisualRegistry.rendererFor(attachment) ?? ocrRendererFallback(unit, attachment);
        if (!attachmentVisible(attachment)) return [];
        return [...(renderer ? [renderer] : []), ...extensionVisualRegistry.overlaysFor(attachment)]
            .filter((descriptor) => visualSourceIsCurrent(unit, attachment, descriptor))
            .map((descriptor) => ({ attachment, descriptor }));
    });
    const replacesOcr = candidates.some(({ attachment, descriptor }) => descriptor.replacesSource
        && descriptor.sourceContext === "ocr-text.v1" && extensionVisualRegistry.sceneFor(descriptor, attachment));
    return candidates.filter(({ attachment }) => !replacesOcr || attachment.attachmentId !== "neuro.official/ocr.result")
        .slice(0, 32);
};
