import type { NodeExecutionConfig } from "../types/unit";

export interface WorkflowPayloadPosition {
    x?: number;
    y?: number;
}

export interface WorkflowPayloadPoint {
    x: number;
    y: number;
}

export interface WorkflowPayloadSize {
    width?: number;
    height?: number;
}

export interface WorkflowPayloadRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface WorkflowNodeDataPayload {
    artId?: string;
    w?: number;
    h?: number;
    params?: Record<string, unknown>;
    src?: string;
    previewSrc?: string;
    rasterizedAnnotationLayerSrc?: string;
    minified?: boolean;
    savedRect?: WorkflowPayloadRect;
    cropOffset?: WorkflowPayloadPoint;
    opacityNormal?: number;
    opacityMini?: number;
    executionConfig?: NodeExecutionConfig;
}

export type WorkflowNodeType = "sticker" | "artNode";

export interface WorkflowNodePayload {
    id: string;
    type: WorkflowNodeType;
    position?: WorkflowPayloadPosition;
    measured?: WorkflowPayloadSize;
    data?: WorkflowNodeDataPayload;
}

export interface WorkflowEdgePayload {
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
}

export interface WorkflowSnapshotPayload {
    mode: "reference" | "clone" | undefined;
    workflowId: string | null | undefined;
    nodes: WorkflowNodePayload[];
    edges: WorkflowEdgePayload[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const stringField = (record: Record<string, unknown>, key: string): string | undefined =>
    typeof record[key] === "string" ? record[key] : undefined;

const numberField = (record: Record<string, unknown>, key: string): number | undefined =>
    typeof record[key] === "number" && Number.isFinite(record[key]) ? record[key] : undefined;

const booleanField = (record: Record<string, unknown>, key: string): boolean | undefined =>
    typeof record[key] === "boolean" ? record[key] : undefined;

const normalizePosition = (value: unknown): WorkflowPayloadPosition | undefined => {
    if (!isRecord(value)) return undefined;
    const x = numberField(value, "x");
    const y = numberField(value, "y");
    return x === undefined && y === undefined ? undefined : { x, y };
};

const normalizePoint = (value: unknown): WorkflowPayloadPoint | undefined => {
    if (!isRecord(value)) return undefined;
    const x = numberField(value, "x");
    const y = numberField(value, "y");
    if (x === undefined || y === undefined) return undefined;
    return { x, y };
};

const normalizeMeasuredSize = (value: unknown): WorkflowPayloadSize | undefined => {
    if (!isRecord(value)) return undefined;
    const width = numberField(value, "width");
    const height = numberField(value, "height");
    return width === undefined && height === undefined ? undefined : { width, height };
};

const normalizeRect = (value: unknown): WorkflowPayloadRect | undefined => {
    if (!isRecord(value)) return undefined;
    const x = numberField(value, "x");
    const y = numberField(value, "y");
    const w = numberField(value, "w");
    const h = numberField(value, "h");
    if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined;
    return { x, y, w, h };
};

const normalizeExecutionConfig = (value: unknown): NodeExecutionConfig | undefined =>
    isRecord(value) ? (value as unknown as NodeExecutionConfig) : undefined;

const normalizeNodeData = (value: unknown): WorkflowNodeDataPayload | undefined => {
    if (!isRecord(value)) return undefined;

    const params = isRecord(value.params) ? value.params : undefined;
    return {
        artId: stringField(value, "artId"),
        w: numberField(value, "w"),
        h: numberField(value, "h"),
        params,
        src: stringField(value, "src"),
        previewSrc: stringField(value, "previewSrc"),
        rasterizedAnnotationLayerSrc: stringField(value, "rasterizedAnnotationLayerSrc"),
        minified: booleanField(value, "minified"),
        savedRect: normalizeRect(value.savedRect),
        cropOffset: normalizePoint(value.cropOffset),
        opacityNormal: numberField(value, "opacityNormal"),
        opacityMini: numberField(value, "opacityMini"),
        executionConfig: normalizeExecutionConfig(value.executionConfig),
    };
};

const normalizeWorkflowNode = (value: unknown): WorkflowNodePayload | null => {
    if (!isRecord(value)) return null;
    const id = stringField(value, "id");
    const type = stringField(value, "type");
    if (!id || (type !== "sticker" && type !== "artNode")) return null;

    let data = normalizeNodeData(value.data);
    if (type === "artNode" && !data?.artId) return null;
    if (type === "sticker" && data?.artId !== undefined) {
        data = { ...data, artId: undefined };
    }

    return {
        id,
        type,
        position: normalizePosition(value.position),
        measured: normalizeMeasuredSize(value.measured),
        data,
    };
};

const normalizeWorkflowEdge = (value: unknown): WorkflowEdgePayload | null => {
    if (!isRecord(value)) return null;
    const source = stringField(value, "source");
    const target = stringField(value, "target");
    if (!source || !target) return null;

    return {
        source,
        target,
        sourceHandle: stringField(value, "sourceHandle"),
        targetHandle: stringField(value, "targetHandle"),
    };
};

export const normalizeWorkflowSnapshotPayload = (payload: unknown): WorkflowSnapshotPayload => {
    if (!isRecord(payload)) {
        return {
            mode: undefined,
            workflowId: undefined,
            nodes: [],
            edges: [],
        };
    }

    const mode = payload.mode === "reference" || payload.mode === "clone" ? payload.mode : undefined;
    const workflowId =
        typeof payload.workflowId === "string" || payload.workflowId === null
            ? payload.workflowId
            : undefined;

    return {
        mode,
        workflowId,
        nodes: Array.isArray(payload.nodes)
            ? payload.nodes.map(normalizeWorkflowNode).filter((node): node is WorkflowNodePayload => node !== null)
            : [],
        edges: Array.isArray(payload.edges)
            ? payload.edges.map(normalizeWorkflowEdge).filter((edge): edge is WorkflowEdgePayload => edge !== null)
            : [],
    };
};
