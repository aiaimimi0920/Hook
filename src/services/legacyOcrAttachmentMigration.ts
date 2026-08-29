// Owns the time-bounded, idempotent import of pre-plugin OCR session data.
import type { UnitData } from "../types/unit";
import type { UnitAttachment, UnitExtensionState } from "../types/unitExtension";
import { buildLegacyOcrAttachmentPayload } from "./legacyOcrAttachmentScene";
import {
    MAX_ATTACHMENTS_PER_UNIT,
    sanitizePersistedUnitExtensionState,
} from "./unitExtensionValidation";

type LegacyOcrResult = NonNullable<UnitData["ocrResult"]>;

export const LEGACY_OCR_PLUGIN_ID = "neuro.official/ocr";
export const LEGACY_OCR_ATTACHMENT_ID = "neuro.official/ocr.result";
export const LEGACY_OCR_TYPE_ID = "neuro.official/ocr.result.v1";
export const LEGACY_OCR_RENDERER_ID = "neuro.official/ocr.result-overlay";

export interface LegacyOcrMigrationResult {
    ocrResult: LegacyOcrResult | undefined;
    extensionState: UnitExtensionState | undefined;
    migrated: boolean;
}

const isCompletedMigrationAttachment = (attachment: UnitAttachment): boolean => {
    if (
        attachment.pluginId !== LEGACY_OCR_PLUGIN_ID
        || attachment.attachmentId !== LEGACY_OCR_ATTACHMENT_ID
        || attachment.typeId !== LEGACY_OCR_TYPE_ID
        || attachment.rendererId !== LEGACY_OCR_RENDERER_ID
    ) return false;
    if (!attachment.payload || typeof attachment.payload !== "object" || Array.isArray(attachment.payload)) return false;
    const payload = attachment.payload as Record<string, unknown>;
    return payload.schemaVersion === "1"
        && typeof payload.fullText === "string"
        && Array.isArray(payload.textBlocks)
        && !!payload.surfaceScene
        && typeof payload.surfaceScene === "object";
};

/**
 * Converts only fully valid legacy data. Failure keeps the old value untouched,
 * so a corrupt/oversized session cannot be silently contracted or partially migrated.
 */
export const migrateLegacyOcrResultToAttachment = (
    ocrResult: LegacyOcrResult | null | undefined,
    extensionState: UnitExtensionState | undefined,
    extensionEnvelopeWasValid = true,
): LegacyOcrMigrationResult => {
    const legacy = ocrResult ?? undefined;
    if (!legacy) return { ocrResult: undefined, extensionState, migrated: false };
    if (!extensionEnvelopeWasValid) {
        return { ocrResult: legacy, extensionState, migrated: false };
    }
    const existing = extensionState?.attachments.find((attachment) =>
        attachment.attachmentId === LEGACY_OCR_ATTACHMENT_ID);
    if (existing) {
        return isCompletedMigrationAttachment(existing)
            ? { ocrResult: undefined, extensionState, migrated: true }
            : { ocrResult: legacy, extensionState, migrated: false };
    }
    const attachments = extensionState?.attachments ?? [];
    if (attachments.length >= MAX_ATTACHMENTS_PER_UNIT) {
        return { ocrResult: legacy, extensionState, migrated: false };
    }
    const revision = extensionState?.revision ?? 0;
    if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
        return { ocrResult: legacy, extensionState, migrated: false };
    }
    const payload = buildLegacyOcrAttachmentPayload(legacy);
    if (!payload) return { ocrResult: legacy, extensionState, migrated: false };
    const candidate: UnitExtensionState = {
        schemaVersion: 1,
        revision: revision + 1,
        attachments: [...attachments, {
            attachmentId: LEGACY_OCR_ATTACHMENT_ID,
            typeId: LEGACY_OCR_TYPE_ID,
            schemaVersion: "1",
            revision: 1,
            pluginId: LEGACY_OCR_PLUGIN_ID,
            pluginVersion: "1.0.0",
            rendererId: LEGACY_OCR_RENDERER_ID,
            payload,
            resourceRefs: [],
        }],
    };
    const sanitized = sanitizePersistedUnitExtensionState(candidate);
    return sanitized
        ? { ocrResult: undefined, extensionState: sanitized, migrated: true }
        : { ocrResult: legacy, extensionState, migrated: false };
};
