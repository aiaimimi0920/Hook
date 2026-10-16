import type { SurfaceHostCapabilities, SurfacePackageManifest } from "../../features/surfaces/services/surfaceProtocol";

export type TransportMode = 'websocket' | 'shared_memory' | 'cloudflare_relay';
export interface ArtParamOption {
    value: string | number | boolean;
    label: string;
}

export interface ArtParam {
    id: string;
    label: string;
    widget: string; // "slider" | "checkbox" | "radio" | "select" | "color" | "text" | "file" | "image_link"
    min?: number;
    max?: number;
    default: unknown;
    step?: number;
    options?: ArtParamOption[];
    multiline?: boolean; // For text widget
    group?: string; // Optional UI grouping label for large parameter panels
    data_type?: string;
    required?: boolean;
    secret?: boolean;
    disabled?: boolean;
}

export interface ArtPortDefinition {
    name: string;
    label: string;
    type: string;
    default?: unknown;
    defaultVisible?: boolean;
    exposePort?: boolean;
    execution_type?: string;
    data_type?: string;
    widget?: string;
    required?: boolean;
}

export interface ArtCapability {
    id: string;
    label: string;
    description: string;
    supported_transports: TransportMode[];
    params: ArtParam[];
    enabled?: boolean;
    auto_process?: boolean;
    execution?: Record<string, unknown>;
    defaults?: Record<string, unknown>;
    metadata?: {
        capabilities?: ArtCapabilityMetadata;
        [key: string]: unknown;
    };
    defaultVisibility?: Record<string, boolean>;
    inputs?: ArtPortDefinition[];
    outputs?: ArtPortDefinition[];
}

/**
 * Optional behavior advertised by an installed Art package.
 *
 * The host must not infer these behaviors from an Art id or from a framework
 * implementation detail.
 */
export interface ArtCapabilityMetadata {
    preview?: string;
    requiresLiveInputs?: boolean;
    requiresFormalExecution?: boolean;
    shaderInput?: string;
    shaderReferenceInput?: string;
    parameterEditor?: string;
    shader?: boolean;
    surface?: SurfacePackageManifest;
    [key: string]: unknown;
}

export interface HandshakeRequest {
    protocolVersion: "loom.hook.v1";
    supportedProtocolVersions: string[];
    clientId: string;
    clientVersion: string;
    platform: string;
    deviceId?: string;
    transports: TransportMode[];
    surface?: SurfaceHostCapabilities;
}

export interface HandshakeResponse {
    protocolVersion: "loom.hook.v1";
    serverName: string;
    serverVersion: string;
    capabilities: {
        artDefinitions: ArtCapability[];
        surface: SurfaceHostCapabilities;
        operations: string[];
    };
    transport: TransportMode;
    sessionId: string;
}

export interface ArtResultCandidate {
    index: number;
    title?: string;
    imageUrl: string;
    thumbnail?: string;
    preview?: string;
    thumbnailUrl?: string;
    sourcePageUrl?: string;
    width?: number;
    height?: number;
    cachedImagePath?: string;
    cachedImageSrc?: string;
    cachedThumbnailPath?: string;
    cachedThumbnailSrc?: string;
}

export interface ArtResultCandidateMetadata {
    kind?: string;
    items: ArtResultCandidate[];
    selectedIndex?: number;
}

export interface DeliveryPayload {
    type: 'shared_memory' | 'base64' | 'file_path' | 'value';
    handle?: string; // for shared_memory
    size?: number;   // for shared_memory
    width?: number;  // for shared_memory/base64
    height?: number; // for shared_memory/base64
    format?: 'rgba8'; // for shared_memory
    data?: string;   // for base64
    path?: string;   // for file_path
    value?: unknown; // for scalar/value outputs
    outputs?: Record<string, unknown>; // optional explicit port-value map
    candidates?: ArtResultCandidateMetadata;
}

// Shader response for real-time preview.
export interface ShaderDeliveryPayload {
    type: 'shader';
    vertex_shader: string;     // GLSL vertex shader code
    fragment_shader: string;   // GLSL fragment shader code
    uniforms: {
        [key: string]: number; // Dynamic uniform values
    };
    success: boolean;
}

export interface ArtDelivery {
    art_id: string;
    request_id: string;
    generation?: number;
    preview_revision?: number;
    result_revision?: number;
    phase?: "preview" | "final";
    status: number;
    error?: string;
    delivery: DeliveryPayload | ShaderDeliveryPayload;
}
