export type TransportMode = 'shared_memory' | 'socket' | 'cloudflare_relay';
export type ArtExecutionType =
    | 'script'
    | 'python'
    | 'cloud_api'
    | 'framework_art'
    | 'shader'
    | 'mcp'
    | 'workflow'
    | 'cli'
    | 'cli_wrapper'
    | 'native'
    | 'filter';

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
    execution_type?: ArtExecutionType;
    execution?: Record<string, unknown>;
    defaults?: Record<string, unknown>;
    qualifiedId?: string;
    legacyId?: string;
    capabilities?: ArtCapabilityMetadata;
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
 * implementation detail. execution_type remains a compatibility fallback
 * for older Loom daemons.
 */
export interface ArtCapabilityMetadata {
    preview?: string;
    requiresLiveInputs?: boolean;
    parameterEditor?: string;
    shader?: boolean;
    [key: string]: unknown;
}

export interface HandshakeRequest {
    client_name: string;
    client_version: string;
    preferred_transports: TransportMode[];
}

export interface HandshakeResponse {
    server_name: string;
    capabilities: {
        art_definitions: ArtCapability[];
        // Add other fields if needed, e.g. supported_interactions
    };
    negotiated_transport: TransportMode;
    session_id: string;
}

export interface PropChange {
    art_id: string;
    prop_id: string;
    value: any;
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

/**
 * Compatibility aliases for the pre-pluginized image-search response shape.
 * New code should use ArtResultCandidate and ArtResultCandidateMetadata.
 */
export type DeliveryImageSearchCandidate = ArtResultCandidate;

export interface DeliveryImageSearchMetadata {
    candidates: ArtResultCandidate[];
    selectedIndex?: number;
}

export interface DeliveryPayload {
    type: 'shm' | 'shared_memory' | 'base64' | 'url' | 'socket' | 'shader' | 'file_path' | 'value' | 'json' | 'text' | 'number';
    handle?: string; // for shm
    size?: number;   // for shm
    width?: number;  // for shm/base64
    height?: number; // for shm/base64
    data?: string;   // for base64
    url?: string;    // for url
    port?: number;   // for socket
    path?: string;   // for file_path
    value?: unknown; // for scalar/value outputs
    outputs?: Record<string, unknown>; // optional explicit port-value map
    candidates?: ArtResultCandidateMetadata;
    imageSearch?: DeliveryImageSearchMetadata;
}

// Shader response from Python Art (for real-time preview)
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
    status: number;
    error?: string;
    delivery: DeliveryPayload | ShaderDeliveryPayload;
}
