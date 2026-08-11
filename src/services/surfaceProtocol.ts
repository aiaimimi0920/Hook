export const SURFACE_PROTOCOL_VERSION = "loom.surface.v1" as const;
export const SURFACE_API_VERSION = "1.0" as const;
export const DECLARATIVE_SURFACE_NODE_TYPES = [
    "view",
    "row",
    "column",
    "stack",
    "scroll",
    "text",
    "image",
    "icon",
    "button",
    "input",
    "textarea",
    "number",
    "slider",
    "switch",
    "select",
    "progress",
    "divider",
    "spacer",
] as const;

export type SurfaceRuntimeKind =
    | "declarative"
    | "javascript"
    | "shader"
    | "loom_remote";

export type SurfaceThemeMode = "host" | "custom";
export type SurfaceSizeClass = "compact" | "medium" | "expanded";
export type SurfaceInstanceMode = "independent" | "shared";

export interface SurfaceSize {
    width: number;
    height: number;
}

export interface SurfaceVariant {
    runtime: SurfaceRuntimeKind;
    entry: string;
    requiredCapabilities?: string[];
}

export interface SurfaceStateMigration {
    from: number;
    to: number;
    entry: string;
}

export interface SurfacePackageManifest {
    protocolVersion: typeof SURFACE_PROTOCOL_VERSION;
    apiVersion: string;
    variants: SurfaceVariant[];
    fallbackScene?: string;
    requiredNodes?: string[];
    requiredCapabilities?: string[];
    actions?: SurfaceActionDefinition[];
    instanceMode?: SurfaceInstanceMode;
    stateSchemaVersion?: number;
    migrations?: SurfaceStateMigration[];
    minimumSize?: SurfaceSize;
    themeMode?: SurfaceThemeMode;
}

export interface SurfaceInputCapabilities {
    pointer: boolean;
    hover: boolean;
    touch: boolean;
    keyboard: boolean;
}

export interface SurfaceHostCapabilities {
    apiVersion: string;
    runtimes: SurfaceRuntimeKind[];
    nodes: string[];
    transports: string[];
    capabilities: string[];
    input: SurfaceInputCapabilities;
}

export interface SurfaceHandshake {
    protocolVersion: typeof SURFACE_PROTOCOL_VERSION;
    clientId: string;
    clientVersion: string;
    platform: string;
    capabilities: SurfaceHostCapabilities;
}

export type SurfaceInstancePersistence = "temporary" | "persistent";

export interface SurfaceInstanceDescriptor {
    instanceId: string;
    artId: string;
    artVersion: string;
    packageDigest: string;
    stateSchemaVersion: number;
  persistence: SurfaceInstancePersistence;
  generation: number;
  surfaceRevision: number;
  previewRevision: number;
  resultRevision: number;
}

export interface SurfaceAttachmentDescriptor {
    attachmentId: string;
    instanceId: string;
    hookNodeId: string;
    deviceId: string;
}

export interface SurfaceNode {
    id: string;
    type: string;
    props?: unknown;
    layout?: unknown;
    style?: unknown;
    accessibility?: unknown;
    events?: Record<string, string>;
    children?: SurfaceNode[];
}

export type SurfaceResourceKind = "image" | "audio" | "video" | "file" | "binary";

export interface SurfaceResourceDescriptor {
    resourceId: string;
    kind: SurfaceResourceKind;
    mime: string;
    size: number;
    width?: number;
    height?: number;
}

export type SurfaceResourceTransportKind = "shared_memory" | "loom_resource" | "stream";

export interface SurfaceResourceTransport {
    kind: SurfaceResourceTransportKind;
    handle?: string;
    path?: string;
    streamId?: string;
}

export interface SurfaceResourceLease {
    leaseId: string;
    resource: SurfaceResourceDescriptor;
    transport: SurfaceResourceTransport;
    expiresAtMs: number;
}

export interface SurfaceStreamDescriptor {
    streamId: string;
    itemType: string;
    mime?: string;
    sequence: number;
}

export type SurfacePortValue =
    | { kind: "value"; value: unknown }
    | { kind: "resource"; resource: SurfaceResourceDescriptor }
    | { kind: "stream"; stream: SurfaceStreamDescriptor };

export type SurfacePortKind =
    | "boolean"
    | "integer"
    | "number"
    | "string"
    | "enum"
    | "object"
    | "list"
    | "table"
    | "image"
    | "audio"
    | "video"
    | "file"
    | "binary"
    | "stream";

export interface SurfacePortDefinition {
    id: string;
    label: string;
    type: SurfacePortKind;
    schema?: unknown;
    primary?: boolean;
    required?: boolean;
}

export interface SurfaceSnapshot {
    protocolVersion: typeof SURFACE_PROTOCOL_VERSION;
    instanceId: string;
    attachmentId: string;
    artId: string;
    artVersion: string;
    revision: number;
    runtime?: SurfaceRuntimeKind;
    entryResourceId?: string;
    scene: SurfaceNode;
    authoritativeState?: unknown;
    resources?: SurfaceResourceDescriptor[];
    resourceLeases?: SurfaceResourceLease[];
}

export type SurfacePatchOperation =
    | { op: "set"; nodeId: string; path: string; value: unknown }
    | { op: "remove"; nodeId: string; path: string }
    | { op: "insert_node"; parentId: string; index: number; node: SurfaceNode }
    | { op: "remove_node"; nodeId: string }
    | { op: "move_node"; nodeId: string; parentId: string; index: number }
    | { op: "replace_node"; nodeId: string; node: SurfaceNode }
    | { op: "set_visibility"; nodeId: string; visible: boolean }
    | { op: "set_binding"; nodeId: string; path: string; binding: string };

export interface SurfacePatch {
    protocolVersion: typeof SURFACE_PROTOCOL_VERSION;
    instanceId: string;
    attachmentId: string;
    baseRevision: number;
    revision: number;
    operations: SurfacePatchOperation[];
    statePatch?: unknown;
    resources?: SurfaceResourceDescriptor[];
    resourceLeases?: SurfaceResourceLease[];
}

export type SurfaceEventClass = "discrete" | "continuous" | "commit" | "local";

export interface SurfaceEvent {
    protocolVersion: typeof SURFACE_PROTOCOL_VERSION;
    instanceId: string;
    attachmentId: string;
    eventId: string;
    nodeId: string;
    event: string;
    action?: string;
    class: SurfaceEventClass;
    generation: number;
    baseRevision: number;
    payload?: unknown;
}

export type SurfaceActionRisk = "low" | "medium" | "high";
export type SurfaceOfflinePolicy = "reject" | "queue";
export type SurfaceActionConcurrency =
    | "replace_latest"
    | "serial"
    | "parallel"
    | "reject_while_running"
    | "coalesce";

export interface SurfaceActionDefinition {
    id: string;
    inputSchema?: unknown;
    risk: SurfaceActionRisk;
    offlinePolicy: SurfaceOfflinePolicy;
    concurrency: SurfaceActionConcurrency;
    idempotent?: boolean;
    confirmation?: boolean;
    cancelable?: boolean;
    timeoutMs?: number;
    progress?: boolean;
}

export type SurfaceActionStatus =
    | "accepted"
    | "awaiting_confirmation"
    | "queued"
    | "running"
    | "cancel_requested"
    | "cancelled"
    | "succeeded"
    | "failed"
    | "interrupted"
    | "unknown";

export interface SurfaceExecutionError {
    code: string;
    message: string;
    detail?: string;
}

export interface SurfaceActionAck {
    protocolVersion: typeof SURFACE_PROTOCOL_VERSION;
    instanceId: string;
    eventId: string;
    requestId: string;
    accepted: boolean;
    status: SurfaceActionStatus;
    error?: SurfaceExecutionError;
}

export interface SurfaceConfirmationRequest {
    protocolVersion: typeof SURFACE_PROTOCOL_VERSION;
    confirmationId: string;
    instanceId: string;
    attachmentId: string;
    deviceId: string;
    hookNodeId: string;
    eventId: string;
    requestId: string;
    actionId: string;
    risk: SurfaceActionRisk;
    expiresAtMs: number;
    payload?: unknown;
}

export interface SurfaceConfirmationDecision {
    protocolVersion: typeof SURFACE_PROTOCOL_VERSION;
    confirmationId: string;
    instanceId: string;
    attachmentId: string;
    deviceId: string;
    approved: boolean;
}

export interface SurfaceActionCancelRequest {
    protocolVersion: typeof SURFACE_PROTOCOL_VERSION;
    instanceId: string;
    requestId: string;
    deviceId: string;
}

export interface SurfaceActionProgress {
    protocolVersion: typeof SURFACE_PROTOCOL_VERSION;
    instanceId: string;
    requestId: string;
    generation: number;
    value?: number;
    stage?: string;
    messageKey?: string;
}

export interface SurfaceActionInvocation {
    protocolVersion: typeof SURFACE_PROTOCOL_VERSION;
    instanceId: string;
    attachmentId: string;
    requestId: string;
    eventId: string;
    actionId: string;
    eventClass: SurfaceEventClass;
    generation: number;
    baseRevision: number;
    payload?: unknown;
    authoritativeState?: unknown;
}

export interface SurfaceActionPatchUpdate {
    attachmentId?: string;
    operations?: SurfacePatchOperation[];
    statePatch?: unknown;
    resources?: SurfaceResourceDescriptor[];
    resourceLeases?: SurfaceResourceLease[];
}

export interface SurfaceActionPreviewUpdate {
    portId: string;
    value: SurfacePortValue;
}

export interface SurfaceActionResultUpdate {
    outputs: Record<string, SurfacePortValue>;
    statePatch?: unknown;
}

export interface SurfaceActionResponse {
    protocolVersion: typeof SURFACE_PROTOCOL_VERSION;
    patches?: SurfaceActionPatchUpdate[];
    preview?: SurfaceActionPreviewUpdate;
    result?: SurfaceActionResultUpdate;
}

export interface SurfacePreviewCommit {
    protocolVersion: typeof SURFACE_PROTOCOL_VERSION;
    instanceId: string;
    requestId: string;
    generation: number;
    previewRevision: number;
    portId: string;
    value: SurfacePortValue;
}

export interface SurfaceResultCommit {
    protocolVersion: typeof SURFACE_PROTOCOL_VERSION;
    instanceId: string;
    requestId: string;
    generation: number;
    resultRevision: number;
    outputs: Record<string, SurfacePortValue>;
    statePatch?: unknown;
}

export interface SurfaceExecutionFailure {
    protocolVersion: typeof SURFACE_PROTOCOL_VERSION;
    instanceId: string;
    requestId: string;
    generation: number;
    error: SurfaceExecutionError;
    lastSuccessfulResultRevision?: number;
}

export type SurfaceLifecycleState =
    | "created"
    | "mounted"
    | "active"
    | "inactive"
    | "suspended"
    | "disposed";

export interface SurfaceLifecycleEvent {
    protocolVersion: typeof SURFACE_PROTOCOL_VERSION;
    instanceId: string;
    attachmentId: string;
    state: SurfaceLifecycleState;
    revision: number;
}

const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9._:/-]{1,160}$/;
const SHA256_RESOURCE_PATTERN = /^sha256:[A-Fa-f0-9]{64}$/;

export const isSafeSurfaceIdentifier = (value: string): boolean =>
    SAFE_IDENTIFIER_PATTERN.test(value);

export const isContentAddressedSurfaceResource = (
    resource: Pick<SurfaceResourceDescriptor, "resourceId">,
): boolean => SHA256_RESOURCE_PATTERN.test(resource.resourceId);

export const validateSurfaceNodeIds = (root: SurfaceNode): string[] => {
    const seen = new Set<string>();
    const errors: string[] = [];

    const visit = (node: SurfaceNode) => {
        if (!isSafeSurfaceIdentifier(node.id)) {
            errors.push(`unsafe Surface node id: ${node.id}`);
        } else if (seen.has(node.id)) {
            errors.push(`duplicate Surface node id: ${node.id}`);
        } else {
            seen.add(node.id);
        }
        if (!node.type.trim()) {
            errors.push(`Surface node type is empty: ${node.id}`);
        }
        for (const action of Object.values(node.events ?? {})) {
            if (!isSafeSurfaceIdentifier(action)) {
                errors.push(`unsafe Surface action id: ${action}`);
            }
        }
        for (const child of node.children ?? []) {
            visit(child);
        }
    };

    visit(root);
    return errors;
};

export const canApplySurfacePatch = (
    currentRevision: number,
    patch: Pick<SurfacePatch, "protocolVersion" | "baseRevision" | "revision">,
): boolean =>
    patch.protocolVersion === SURFACE_PROTOCOL_VERSION &&
    patch.baseRevision === currentRevision &&
    patch.revision > patch.baseRevision;

export const isCurrentSurfaceCommit = (
    currentGeneration: number,
    commit: Pick<SurfacePreviewCommit | SurfaceResultCommit, "protocolVersion" | "generation">,
): boolean =>
    commit.protocolVersion === SURFACE_PROTOCOL_VERSION &&
    commit.generation === currentGeneration;
