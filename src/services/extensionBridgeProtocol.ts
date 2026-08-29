import {
    EXTENSION_API_VERSION,
    EXTENSION_PROTOCOL,
    type ContributionSnapshot,
} from "./extensionProtocol";

export const EXTENSION_SNAPSHOT_EVENT = "loom.extension.snapshot.updated";

export type ExtensionTarget = { unitId: string; revision: number };
export type ExtensionResourceUpload = {
    kind: "image";
    mime: string;
    dataBase64: string;
};
export type ExtensionUnitAttachment = {
    attachmentId: string;
    typeId: string;
    schemaVersion: string;
    revision: number;
    pluginId: string;
    pluginVersion: string;
    rendererId?: string;
    payload?: unknown;
    resourceRefs: Array<{
        resourceId: string;
        kind: "file" | "shared_image" | "shared_memory";
        digest: string;
        byteLength: number;
        leaseId: string;
    }>;
};
export type ExtensionEffect = {
    type: "attachment.upsert" | "attachment.remove" | "notice.show" | "clipboard.writeText"
        | "overlay.invalidate" | "resource.publish";
    payload: unknown;
};
export type ExtensionResult = {
    protocol: typeof EXTENSION_PROTOCOL;
    apiVersion: string;
    requestId: string;
    status: "accepted" | "progress" | "succeeded" | "failed" | "cancelled";
    output: unknown;
    effects: ExtensionEffect[];
    error?: { code: string; message: string };
};

export type ExtensionBridgeResponse = {
    protocol: typeof EXTENSION_PROTOCOL;
    apiVersion: string;
    requestId: string;
    status: "succeeded" | "failed";
    data: unknown;
    error?: { code: string; message: string; retryable: boolean };
};

const EXTENSION_EFFECT_TYPES = new Set<ExtensionEffect["type"]>([
    "attachment.upsert",
    "attachment.remove",
    "notice.show",
    "clipboard.writeText",
    "overlay.invalidate",
    "resource.publish",
]);

const record = (value: unknown, field: string): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`);
    return value as Record<string, unknown>;
};

const string = (value: unknown, field: string, maximum = 4096): string => {
    if (typeof value !== "string" || !value || value.length > maximum) {
        throw new Error(`${field} must be a bounded string`);
    }
    return value;
};

export const parseExtensionBridgeResponse = (value: unknown): ExtensionBridgeResponse => {
    const source = record(value, "extension response");
    if (source.protocol !== EXTENSION_PROTOCOL) throw new Error("extension response protocol is unsupported");
    const apiVersion = string(source.apiVersion, "extension response apiVersion", 32);
    if (apiVersion !== EXTENSION_API_VERSION) throw new Error("extension response API version is unsupported");
    const status = string(source.status, "extension response status", 32);
    if (status !== "succeeded" && status !== "failed") throw new Error("extension response status is invalid");
    const error = source.error === undefined ? undefined : record(source.error, "extension response error");
    return {
        protocol: EXTENSION_PROTOCOL,
        apiVersion,
        requestId: string(source.requestId, "extension response requestId", 384),
        status,
        data: source.data,
        error: error ? {
            code: string(error.code, "extension response error code", 128),
            message: string(error.message, "extension response error message"),
            retryable: error.retryable === true,
        } : undefined,
    };
};

export const parseExtensionHandshakeData = (value: unknown): {
    sessionId: string;
    features: string[];
    snapshot: ContributionSnapshot;
} => {
    const source = record(value, "extension handshake data");
    if (!Array.isArray(source.features) || source.features.length > 32) {
        throw new Error("extension handshake features are invalid");
    }
    return {
        sessionId: string(source.sessionId, "extension session id", 384),
        features: source.features.map((feature, index) => string(feature, `features[${index}]`, 128)),
        snapshot: source.snapshot as ContributionSnapshot,
    };
};

export const parseExtensionSnapshotEvent = (value: unknown): unknown | null => {
    const source = record(value, "extension event");
    if (source.protocol !== EXTENSION_PROTOCOL || source.method !== EXTENSION_SNAPSHOT_EVENT) return null;
    if (source.apiVersion !== EXTENSION_API_VERSION) throw new Error("extension event API version is unsupported");
    return record(source.params, "extension event params").snapshot;
};

export const parseExtensionResult = (value: unknown): ExtensionResult => {
    const source = record(value, "extension result");
    if (source.protocol !== EXTENSION_PROTOCOL) throw new Error("extension result protocol is unsupported");
    const apiVersion = string(source.apiVersion, "extension result apiVersion", 32);
    if (apiVersion !== EXTENSION_API_VERSION) throw new Error("extension result API version is unsupported");
    const status = string(source.status, "extension result status", 32) as ExtensionResult["status"];
    if (!["accepted", "progress", "succeeded", "failed", "cancelled"].includes(status)) {
        throw new Error("extension result status is invalid");
    }
    if (!Array.isArray(source.effects) || source.effects.length > 256) {
        throw new Error("extension result effects are invalid");
    }
    return {
        protocol: EXTENSION_PROTOCOL,
        apiVersion,
        requestId: string(source.requestId, "extension result requestId", 384),
        status,
        output: source.output,
        effects: source.effects.map((effect, index) => {
            const item = record(effect, `extension effect ${index}`);
            const type = string(item.type, `extension effect ${index} type`, 64) as ExtensionEffect["type"];
            if (!EXTENSION_EFFECT_TYPES.has(type)) throw new Error(`extension effect ${index} type is unsupported`);
            return { type, payload: item.payload };
        }),
        error: source.error ? {
            code: string(record(source.error, "extension result error").code, "extension result error code", 128),
            message: string(record(source.error, "extension result error").message, "extension result error message"),
        } : undefined,
    };
};

export const extensionProtocolIdentity = {
    protocol: EXTENSION_PROTOCOL,
    apiVersion: EXTENSION_API_VERSION,
} as const;
