import type { Unit } from "../types/unit";
import { visualSourceIsCurrent } from "./extensionVisualSources";

export type StickerExtraTextKind = "ocr" | "translation";
const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === "string" && value.trim() ? value : "";

/** Copy cached full text independently of overlay visibility; never copy a stale translation or truncate it. */
export const stickerExtraText = (unit: Unit | undefined, kind: StickerExtraTextKind): string => {
    if (!unit) return "";
    const plugin = kind === "ocr" ? "neuro.official/ocr" : "neuro.official/text-translation";
    const attachment = unit.data.extensionState?.attachments.find((item) =>
        item.pluginId === plugin && item.typeId === `${plugin}.result.v1` && item.schemaVersion === "1");
    if (attachment) {
        if (kind === "translation" && !visualSourceIsCurrent(unit, attachment, { sourceContext: "ocr-text.v1" })) return "";
        return text(record(attachment.payload)[kind === "ocr" ? "fullText" : "text"]);
    }
    if (kind === "ocr") return text(unit.data.ocrResult?.fullText);
    const legacy = unit.data.translationResult;
    return legacy?.sourceRevision === (unit.data.stickerEditPropagation?.revision ?? 0) ? text(legacy.fullText) : "";
};
