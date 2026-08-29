export type UnitAttachmentResourceKind = "file" | "shared_image" | "shared_memory";

/** Content-addressed resource reference; arbitrary filesystem paths are never persisted. */
export interface UnitAttachmentResourceRef {
    resourceId: string;
    kind: UnitAttachmentResourceKind;
    digest: string;
    byteLength: number;
    leaseId: string;
}

export interface UnitAttachment {
    attachmentId: string;
    typeId: string;
    schemaVersion: string;
    revision: number;
    pluginId: string;
    pluginVersion: string;
    rendererId?: string;
    payload?: unknown;
    payloadDigest?: string;
    resourceRefs: UnitAttachmentResourceRef[];
}

/** Versioned, host-owned envelope for all capability data attached to one unit. */
export interface UnitExtensionState {
    schemaVersion: 1;
    revision: number;
    attachments: UnitAttachment[];
}
