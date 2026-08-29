import type {
    UnitAttachment,
    UnitAttachmentResourceKind,
    UnitAttachmentResourceRef,
    UnitExtensionState,
} from "../types/unitExtension";

export const MAX_ATTACHMENTS_PER_UNIT = 64;
const MAX_RESOURCE_REFS_PER_ATTACHMENT = 16;
const MAX_RESOURCE_BYTES = 64 * 1024 * 1024;
const MAX_PAYLOAD_BYTES = 256 * 1024;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 8_192;
const SHA256 = /^[0-9a-f]{64}$/u;

export const extensionRecord = (value: unknown, field: string): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error(`${field} must be a JSON object`);
    return value as Record<string, unknown>;
};

export const boundedExtensionString = (value: unknown, field: string, maximum = 384): string => {
    if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
        throw new Error(`${field} must be a bounded non-empty string`);
    }
    return value;
};

export const nonNegativeExtensionInteger = (value: unknown, field: string): number => {
    if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${field} must be a non-negative integer`);
    return Number(value);
};

export const validateExtensionJsonValue = (value: unknown): unknown => {
    let nodes = 0;
    const visit = (current: unknown, depth: number): void => {
        nodes += 1;
        if (nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) throw new Error("attachment payload exceeds the JSON budget");
        if (current === null || typeof current === "string" || typeof current === "boolean") return;
        if (typeof current === "number" && Number.isFinite(current)) return;
        if (Array.isArray(current)) {
            current.forEach((item) => visit(item, depth + 1));
            return;
        }
        Object.values(extensionRecord(current, "attachment payload")).forEach((item) => visit(item, depth + 1));
    };
    visit(value, 0);
    const encoded = JSON.stringify(value);
    if (new TextEncoder().encode(encoded).byteLength > MAX_PAYLOAD_BYTES) {
        throw new Error("attachment payload exceeds the byte budget");
    }
    return JSON.parse(encoded) as unknown;
};

const parseResourceRef = (value: unknown, index: number): UnitAttachmentResourceRef => {
    const source = extensionRecord(value, `resourceRefs[${index}]`);
    const digest = boundedExtensionString(source.digest, `resourceRefs[${index}].digest`, 64);
    if (!SHA256.test(digest)) throw new Error(`resourceRefs[${index}].digest must be lowercase SHA-256`);
    const resourceId = boundedExtensionString(source.resourceId, `resourceRefs[${index}].resourceId`, 71);
    if (resourceId !== `sha256:${digest}`) throw new Error(`resourceRefs[${index}] is not content addressed`);
    const kind = boundedExtensionString(source.kind, `resourceRefs[${index}].kind`, 32);
    if (!["file", "shared_image", "shared_memory"].includes(kind)) {
        throw new Error(`resourceRefs[${index}].kind is unsupported`);
    }
    const byteLength = nonNegativeExtensionInteger(source.byteLength, `resourceRefs[${index}].byteLength`);
    if (byteLength > MAX_RESOURCE_BYTES) throw new Error(`resourceRefs[${index}] exceeds the byte budget`);
    return {
        resourceId,
        kind: kind as UnitAttachmentResourceKind,
        digest,
        byteLength,
        leaseId: boundedExtensionString(source.leaseId, `resourceRefs[${index}].leaseId`),
    };
};

export const parseExtensionResourceRefs = (value: unknown): UnitAttachmentResourceRef[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > MAX_RESOURCE_REFS_PER_ATTACHMENT) {
        throw new Error("attachment resourceRefs exceeds the count budget");
    }
    return value.map(parseResourceRef);
};

const assertKeys = (source: Record<string, unknown>, allowed: readonly string[], field: string): void => {
    if (Object.keys(source).some((key) => !allowed.includes(key))) throw new Error(`${field} has unknown fields`);
};

const parsePersistedAttachment = (value: unknown, index: number): UnitAttachment => {
    const source = extensionRecord(value, `attachments[${index}]`);
    assertKeys(source, [
        "attachmentId", "typeId", "schemaVersion", "revision", "pluginId", "pluginVersion",
        "rendererId", "payload", "payloadDigest", "resourceRefs",
    ], `attachments[${index}]`);
    const pluginId = boundedExtensionString(source.pluginId, `attachments[${index}].pluginId`);
    const attachmentId = boundedExtensionString(source.attachmentId, `attachments[${index}].attachmentId`);
    if (!attachmentId.startsWith(`${pluginId}.`)) throw new Error("persisted attachment is outside the plugin namespace");
    const payload = source.payload === undefined ? undefined : validateExtensionJsonValue(source.payload);
    const resourceRefs = parseExtensionResourceRefs(source.resourceRefs);
    if (payload === undefined && resourceRefs.length === 0) throw new Error("persisted attachment has no content");
    const payloadDigest = source.payloadDigest === undefined
        ? undefined
        : boundedExtensionString(source.payloadDigest, `attachments[${index}].payloadDigest`, 64);
    if (payloadDigest && !SHA256.test(payloadDigest)) throw new Error("persisted attachment payload digest is invalid");
    return {
        attachmentId,
        typeId: boundedExtensionString(source.typeId, `attachments[${index}].typeId`),
        schemaVersion: boundedExtensionString(source.schemaVersion, `attachments[${index}].schemaVersion`, 64),
        revision: nonNegativeExtensionInteger(source.revision, `attachments[${index}].revision`),
        pluginId,
        pluginVersion: boundedExtensionString(source.pluginVersion, `attachments[${index}].pluginVersion`, 128),
        rendererId: source.rendererId === undefined
            ? undefined
            : boundedExtensionString(source.rendererId, `attachments[${index}].rendererId`),
        payload,
        payloadDigest,
        resourceRefs,
    };
};

/** Drops a corrupt or over-budget persisted envelope before it reaches rendering. */
export const sanitizePersistedUnitExtensionState = (value: unknown): UnitExtensionState | undefined => {
    if (value === undefined || value === null) return undefined;
    try {
        const source = extensionRecord(value, "extensionState");
        assertKeys(source, ["schemaVersion", "revision", "attachments"], "extensionState");
        if (source.schemaVersion !== 1 || !Array.isArray(source.attachments)
            || source.attachments.length > MAX_ATTACHMENTS_PER_UNIT) return undefined;
        const attachments = source.attachments.map(parsePersistedAttachment);
        if (new Set(attachments.map((attachment) => attachment.attachmentId)).size !== attachments.length) return undefined;
        return {
            schemaVersion: 1,
            revision: nonNegativeExtensionInteger(source.revision, "extensionState.revision"),
            attachments,
        };
    } catch {
        return undefined;
    }
};
