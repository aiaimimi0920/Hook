import type {
    StickerAnnotationState,
    StickerCaptureMeta,
    StickerGroup,
    StickerImageEditState,
} from "./stickerEditing";
import type { ArtResultCandidate } from "../services/protocol";

export interface OcrBlock {
    text: string;
    boxPoints: {x: number, y: number}[];
    boxScore: number;
    textScore: number;
    colorHex: string;
    bgColorHex: string;
    translatedText?: string;
    translating?: boolean;
}

export interface Port {
    id: string;
    type: 'image' | 'text' | 'number' | 'boolean' | 'any';
    direction: 'input' | 'output';
    label?: string;
}

export interface UnitData {
    // Sticker Specific
    src?: string;
    minified?: boolean;
    savedRect?: { x: number, y: number, w: number, h: number };
    cropOffset?: { x: number, y: number };
    opacityNormal?: number;
    opacityMini?: number;

    // UI State
    hideOcr?: boolean;
    showTranslated?: boolean;

    // Visibility Control
    portVisibility?: Record<string, boolean>; // Key: specific port name, Value: true (visible) / false. Default if missing = true? or false?
    // Let's assume default is TRUE (show all), and we use this to hide specific ones.

    // Disabled Params Stash (Value restoration)
    disabledParamValues?: Record<string, any>;

    // OCR Results
    ocrResult?: {
        fullText: string;
        textBlocks: OcrBlock[];
        width?: number;
        height?: number;
        scaleFactor?: number;
    };

    // Art Specific
    processing?: boolean;
    progress?: number;
    previewSrc?: string; // Result from Art Node (Shared Memory)
    restoredPreviewLocked?: boolean; // Restored shader art keeps persisted preview until a real invalidation occurs
    errorMessage?: string;
    rasterizedAnnotationLayerSrc?: string; // Transparent flattened annotation layer above src
    resultHandle?: string; // SHM Handle
    filePath?: string; // Local File Path (for Drag-Out optimization)
    dragOutFilePath?: string; // Composite snapshot path used for fast Shift-drag export
    outputs?: Record<string, unknown>; // Port-value map for scalar/image outputs that can drive downstream params
    resultCandidates?: ArtResultCandidate[];
    selectedResultIndex?: number;
    imageSearchRecoveryPending?: boolean;

    // Reference Sync
    originWorkflowId?: string;
    originNodeId?: string;

    // Sticker editing foundation
    annotationState?: StickerAnnotationState;
    imageEditState?: StickerImageEditState;
    stickerEditPropagation?: StickerEditPropagationState;
    groupId?: string;
    captureMeta?: StickerCaptureMeta;

    // Execution System
    executionConfig?: NodeExecutionConfig;
    nodeStatus?: NodeStatus;
}

export interface StickerEditPropagationState {
    /** Default true. When false, upstream sticker annotation edits stop at this sticker. */
    acceptUpstream?: boolean;
    /** Set by direct user edits; upstream annotation edits no longer overwrite this sticker. */
    locallyEdited?: boolean;
    /** Monotonic local edit counter for traceability and future conflict checks. */
    revision?: number;
    /** Last direct upstream sticker that supplied propagated annotation edits. */
    upstreamSourceUnitId?: string;
    /** The upstream revision observed when propagated. */
    upstreamSourceRevision?: number;
}

// ============================================================================
// Node Execution System Types
// ============================================================================

/** Trigger conditions for node execution */
export interface TriggerMode {
    /** Execute when any upstream node completes (and all upstreams are idle) */
    upstreamDriven: boolean;
    /** Execute when any parameter changes */
    paramDriven: boolean;
}

/** Signal propagation controls */
export interface PropagationConfig {
    /** Whether to listen for upstream completion signals */
    listenUpstream: boolean;
    /** Whether to emit completion signal to downstream nodes */
    notifyDownstream: boolean;
}

/** Complete execution configuration for a node */
export interface NodeExecutionConfig {
    triggerMode: TriggerMode;
    propagation: PropagationConfig;
    /** UI state: whether settings panel is expanded */
    __expanded?: boolean;
}

/** Runtime status of a node */
export type NodeStatus = 'idle' | 'pending' | 'running' | 'completed' | 'error';

/** Default execution config (reactive mode) */
export const DEFAULT_EXECUTION_CONFIG: NodeExecutionConfig = {
    triggerMode: {
        upstreamDriven: true,
        paramDriven: true,
    },
    propagation: {
        listenUpstream: true,
        notifyDownstream: true,
    },
};

export interface Unit {
    id: string;
    // 'sticker' = Raw Image/Screenshot
    // 'art' = Functional Node
    type: 'sticker' | 'art';

    // Art ID if type is art (e.g. 'oil_paint')
    artId?: string;

    x: number;
    y: number;
    w: number;
    h: number;

    data: UnitData;
    params: Record<string, any>; // Slider values etc.

    inputs: Port[];
    outputs: Port[];
}

export interface Link {
    id: string;
    fromUnitId: string;
    fromPortId: string;
    toUnitId: string;
    toPortId: string;
}

// ============================================================================
// Session persistence shapes
// ============================================================================
// The serialized session (load_session / save_session and the browser-preview
// localStorage fallback) is a flattened form of Unit, not the Unit itself. The
// write mappers emit `null` for absent fields; the read mapper tolerates
// `null`/`undefined`. These interfaces replace the `any` that previously spanned
// the whole IPC/session boundary so a backend field rename becomes a compile
// error instead of a silent `undefined` at runtime.

export interface SessionSticker {
    id: string;
    type?: Unit["type"];
    artId?: string | null;
    x: number;
    y: number;
    w: number;
    h: number;
    src?: string | null;
    previewSrc?: string | null;
    minified?: boolean | null;
    savedRect?: { x: number; y: number; w: number; h: number } | null;
    cropOffset?: { x: number; y: number } | null;
    opacityNormal?: number | null;
    opacityMini?: number | null;
    params?: Record<string, unknown> | null;
    filePath?: string | null;
    rasterizedAnnotationLayerSrc?: string | null;
    outputs?: Record<string, unknown> | null;
    originWorkflowId?: string | null;
    originNodeId?: string | null;
    executionConfig?: NodeExecutionConfig | null;
    annotationState?: UnitData["annotationState"] | null;
    imageEditState?: UnitData["imageEditState"] | null;
    groupId?: string | null;
    captureMeta?: UnitData["captureMeta"] | null;
}

export interface SessionLink {
    id: string;
    fromUnitId: string;
    fromPortId: string;
    toUnitId: string;
    toPortId: string;
}

export interface SessionGroup {
    id: string;
    name: string;
    hidden?: boolean;
    locked?: boolean;
}

export interface WorkflowAssetArchiveNodeHint {
    stickerId: string;
}

export interface WorkflowAssetArchiveWorkflowHint {
    nodes: Record<string, WorkflowAssetArchiveNodeHint>;
}

export interface WorkflowAssetArchiveHints {
    workflows: Record<string, WorkflowAssetArchiveWorkflowHint>;
}

export interface WorkflowAssetArchiveNodeIndex {
    stickerId: string;
    updatedAt: string;
    src?: string | null;
    previewSrc?: string | null;
}

export interface WorkflowAssetArchiveWorkflowIndex {
    updatedAt: string;
    nodes: Record<string, WorkflowAssetArchiveNodeIndex>;
}

export interface WorkflowAssetArchiveIndex {
    version: number;
    workflows: Record<string, WorkflowAssetArchiveWorkflowIndex>;
}

export type { StickerGroup };
