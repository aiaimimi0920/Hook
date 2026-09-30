// Owns the lossless, idempotent import of the former Hook-native barcode result.
import type { BarcodeScanResult } from "../types/unit";
import type { UnitAttachment, UnitExtensionState } from "../types/unitExtension";
import { buildLegacyBarcodeAttachmentPayload } from "./legacyBarcodeAttachmentScene";
import {
    MAX_ATTACHMENTS_PER_UNIT,
    sanitizePersistedUnitExtensionState,
} from "./unitExtensionValidation";

export const LEGACY_CODES_PLUGIN_ID = "neuro.official/ocr";
export const LEGACY_CODES_ATTACHMENT_ID = "neuro.official/ocr.codes";
export const LEGACY_CODES_TYPE_ID = "neuro.official/ocr.codes.v1";
export const LEGACY_CODES_RENDERER_ID = "neuro.official/ocr.codes-overlay";

export interface LegacyBarcodeMigrationResult {
    barcodeResult: BarcodeScanResult | undefined;
    extensionState: UnitExtensionState | undefined;
    migrated: boolean;
}

const completedAttachment = (attachment: UnitAttachment): boolean => {
    if (attachment.pluginId !== LEGACY_CODES_PLUGIN_ID
        || attachment.attachmentId !== LEGACY_CODES_ATTACHMENT_ID
        || attachment.typeId !== LEGACY_CODES_TYPE_ID
        || attachment.rendererId !== LEGACY_CODES_RENDERER_ID
        || !attachment.payload
        || typeof attachment.payload !== "object"
        || Array.isArray(attachment.payload)) return false;
    const payload = attachment.payload as Record<string, unknown>;
    return payload.schemaVersion === "1"
        && Array.isArray(payload.results)
        && Boolean(payload.surfaceScene)
        && typeof payload.surfaceScene === "object";
};

/** Clears legacy data only after the complete plugin attachment survives validation. */
export const migrateLegacyBarcodeResultToAttachment = (
    barcodeResult: BarcodeScanResult | null | undefined,
    extensionState: UnitExtensionState | undefined,
    extensionEnvelopeWasValid = true,
): LegacyBarcodeMigrationResult => {
    const legacy = barcodeResult ?? undefined;
    if (!legacy) return { barcodeResult: undefined, extensionState, migrated: false };
    if (!extensionEnvelopeWasValid) {
        return { barcodeResult: legacy, extensionState, migrated: false };
    }
    const existing = extensionState?.attachments.find((attachment) =>
        attachment.attachmentId === LEGACY_CODES_ATTACHMENT_ID);
    if (existing) {
        return completedAttachment(existing)
            ? { barcodeResult: undefined, extensionState, migrated: true }
            : { barcodeResult: legacy, extensionState, migrated: false };
    }
    const attachments = extensionState?.attachments ?? [];
    if (attachments.length >= MAX_ATTACHMENTS_PER_UNIT) {
        return { barcodeResult: legacy, extensionState, migrated: false };
    }
    const revision = extensionState?.revision ?? 0;
    if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
        return { barcodeResult: legacy, extensionState, migrated: false };
    }
    const payload = buildLegacyBarcodeAttachmentPayload(legacy);
    if (!payload) return { barcodeResult: legacy, extensionState, migrated: false };
    const candidate: UnitExtensionState = {
        schemaVersion: 1,
        revision: revision + 1,
        attachments: [...attachments, {
            attachmentId: LEGACY_CODES_ATTACHMENT_ID,
            typeId: LEGACY_CODES_TYPE_ID,
            schemaVersion: "1",
            revision: 1,
            pluginId: LEGACY_CODES_PLUGIN_ID,
            pluginVersion: "1.1.0",
            rendererId: LEGACY_CODES_RENDERER_ID,
            payload,
            resourceRefs: [],
        }],
    };
    const sanitized = sanitizePersistedUnitExtensionState(candidate);
    return sanitized
        ? { barcodeResult: undefined, extensionState: sanitized, migrated: true }
        : { barcodeResult: legacy, extensionState, migrated: false };
};
