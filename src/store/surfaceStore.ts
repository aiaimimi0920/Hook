import { createStore, reconcile } from "solid-js/store";
import {
    SURFACE_PROTOCOL_VERSION,
    SurfacePatch,
    SurfacePatchOperation,
    SurfaceLifecycleEvent,
    SurfaceLifecycleState,
    SurfacePreviewCommit,
    SurfaceResultCommit,
    SurfaceSnapshot,
    canApplySurfacePatch,
    validateSurfaceNodeIds,
} from "../services/surfaceProtocol";

export interface SurfaceViewState {
    snapshot: SurfaceSnapshot;
    generation: number;
    previewRevision: number;
    resultRevision: number;
    lifecycle: SurfaceLifecycleState;
    lifecycleRevision: number;
}

export class SurfaceStateError extends Error {
    constructor(
        public readonly code: "invalid_snapshot" | "revision_conflict" | "invalid_patch",
        message: string,
    ) {
        super(message);
        this.name = "SurfaceStateError";
    }
}

const cloneSnapshot = (snapshot: SurfaceSnapshot): SurfaceSnapshot =>
    JSON.parse(JSON.stringify(snapshot)) as SurfaceSnapshot;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const mergeJson = (target: unknown, patch: unknown): unknown => {
    if (!isRecord(patch)) return patch;

    const next: Record<string, unknown> = isRecord(target) ? { ...target } : {};
    for (const [key, value] of Object.entries(patch)) {
        if (value === null) {
            delete next[key];
        } else {
            next[key] = mergeJson(next[key], value);
        }
    }
    return next;
};

const visitNode = (
    root: SurfaceSnapshot["scene"],
    nodeId: string,
): SurfaceSnapshot["scene"] | undefined => {
    if (root.id === nodeId) return root;
    for (const child of root.children ?? []) {
        const match = visitNode(child, nodeId);
        if (match) return match;
    }
    return undefined;
};

const removeNode = (
    root: SurfaceSnapshot["scene"],
    nodeId: string,
): SurfaceSnapshot["scene"] | undefined => {
    const children = root.children ?? [];
    const index = children.findIndex((child) => child.id === nodeId);
    if (index >= 0) {
        return children.splice(index, 1)[0];
    }
    for (const child of children) {
        const removed = removeNode(child, nodeId);
        if (removed) return removed;
    }
    return undefined;
};

const decodePointerToken = (token: string): string =>
    token.replace(/~1/g, "/").replace(/~0/g, "~");

const pointerTokens = (path: string): string[] => {
    if (!path.startsWith("/")) {
        throw new SurfaceStateError("invalid_patch", "Surface patch path must be a JSON pointer");
    }
    return path.slice(1).split("/").map(decodePointerToken);
};

const assertMutableNodePath = (path: string): void => {
    const allowed = ["/props", "/layout", "/style", "/accessibility", "/events"];
    if (!allowed.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
        throw new SurfaceStateError(
            "invalid_patch",
            "Surface node patch may only update props, layout, style, accessibility, or events",
        );
    }
};

const setAtPointer = (target: Record<string, unknown>, path: string, value: unknown): void => {
    const tokens = pointerTokens(path);
    const last = tokens.pop();
    if (!last) throw new SurfaceStateError("invalid_patch", "Surface patch path is empty");
    let cursor = target;
    for (const token of tokens) {
        const child = cursor[token];
        if (!isRecord(child)) cursor[token] = {};
        cursor = cursor[token] as Record<string, unknown>;
    }
    cursor[last] = value;
};

const removeAtPointer = (target: Record<string, unknown>, path: string): void => {
    const tokens = pointerTokens(path);
    const last = tokens.pop();
    if (!last) throw new SurfaceStateError("invalid_patch", "Surface patch path is empty");
    let cursor = target;
    for (const token of tokens) {
        const child = cursor[token];
        if (!isRecord(child)) return;
        cursor = child;
    }
    delete cursor[last];
};

const mutateNodeJson = (
    scene: SurfaceSnapshot["scene"],
    nodeId: string,
    path: string,
    value: unknown,
    remove: boolean,
): void => {
    assertMutableNodePath(path);
    const node = visitNode(scene, nodeId);
    if (!node) throw new SurfaceStateError("invalid_patch", `Surface node was not found: ${nodeId}`);
    const stableId = node.id;
    const encoded = node as unknown as Record<string, unknown>;
    if (remove) removeAtPointer(encoded, path);
    else setAtPointer(encoded, path, value);
    if (node.id !== stableId) {
        throw new SurfaceStateError("invalid_patch", "Surface patch changed a stable node id");
    }
};

const applyOperation = (
    scene: SurfaceSnapshot["scene"],
    operation: SurfacePatchOperation,
): void => {
    switch (operation.op) {
        case "set":
            mutateNodeJson(scene, operation.nodeId, operation.path, operation.value, false);
            return;
        case "remove":
            mutateNodeJson(scene, operation.nodeId, operation.path, undefined, true);
            return;
        case "insert_node": {
            const parent = visitNode(scene, operation.parentId);
            if (!parent) {
                throw new SurfaceStateError(
                    "invalid_patch",
                    `Surface parent node was not found: ${operation.parentId}`,
                );
            }
            const children = parent.children ?? (parent.children = []);
            if (operation.index < 0 || operation.index > children.length) {
                throw new SurfaceStateError("invalid_patch", "Surface insert index is out of range");
            }
            children.splice(operation.index, 0, operation.node);
            return;
        }
        case "remove_node":
            if (scene.id === operation.nodeId) {
                throw new SurfaceStateError("invalid_patch", "Surface root node cannot be removed");
            }
            if (!removeNode(scene, operation.nodeId)) {
                throw new SurfaceStateError(
                    "invalid_patch",
                    `Surface node was not found: ${operation.nodeId}`,
                );
            }
            return;
        case "move_node": {
            if (scene.id === operation.nodeId) {
                throw new SurfaceStateError("invalid_patch", "Surface root node cannot be moved");
            }
            const node = removeNode(scene, operation.nodeId);
            if (!node) {
                throw new SurfaceStateError(
                    "invalid_patch",
                    `Surface node was not found: ${operation.nodeId}`,
                );
            }
            const parent = visitNode(scene, operation.parentId);
            if (!parent) {
                throw new SurfaceStateError("invalid_patch", "Surface node cannot move into itself");
            }
            const children = parent.children ?? (parent.children = []);
            if (operation.index < 0 || operation.index > children.length) {
                throw new SurfaceStateError("invalid_patch", "Surface move index is out of range");
            }
            children.splice(operation.index, 0, node);
            return;
        }
        case "replace_node": {
            if (operation.node.id !== operation.nodeId) {
                throw new SurfaceStateError(
                    "invalid_patch",
                    "Surface replacement node must preserve its stable id",
                );
            }
            const target = visitNode(scene, operation.nodeId);
            if (!target) {
                throw new SurfaceStateError(
                    "invalid_patch",
                    `Surface node was not found: ${operation.nodeId}`,
                );
            }
            Object.keys(target).forEach((key) => delete (target as unknown as Record<string, unknown>)[key]);
            Object.assign(target, operation.node);
            return;
        }
        case "set_visibility": {
            const node = visitNode(scene, operation.nodeId);
            if (!node) {
                throw new SurfaceStateError(
                    "invalid_patch",
                    `Surface node was not found: ${operation.nodeId}`,
                );
            }
            const props = isRecord(node.props) ? { ...node.props } : {};
            props.visible = operation.visible;
            node.props = props;
            return;
        }
        case "set_binding": {
            const node = visitNode(scene, operation.nodeId);
            if (!node) {
                throw new SurfaceStateError(
                    "invalid_patch",
                    `Surface node was not found: ${operation.nodeId}`,
                );
            }
            const props = isRecord(node.props) ? { ...node.props } : {};
            const bindings = isRecord(props.bindings) ? { ...props.bindings } : {};
            bindings[operation.path] = operation.binding;
            props.bindings = bindings;
            node.props = props;
        }
    }
};

export const applySurfacePatchToSnapshot = (
    current: SurfaceSnapshot,
    patch: SurfacePatch,
): SurfaceSnapshot => {
    if (patch.instanceId !== current.instanceId || patch.attachmentId !== current.attachmentId) {
        throw new SurfaceStateError("invalid_patch", "Surface patch identity does not match snapshot");
    }
    if (!canApplySurfacePatch(current.revision, patch)) {
        throw new SurfaceStateError(
            "revision_conflict",
            `Surface patch base ${patch.baseRevision} does not match revision ${current.revision}`,
        );
    }

    const next = cloneSnapshot(current);
    for (const operation of patch.operations) applyOperation(next.scene, operation);
    const nodeErrors = validateSurfaceNodeIds(next.scene);
    if (nodeErrors.length > 0) {
        throw new SurfaceStateError("invalid_patch", nodeErrors.join("; "));
    }
    next.authoritativeState = mergeJson(next.authoritativeState, patch.statePatch ?? {});
    const resources = new Map((next.resources ?? []).map((resource) => [resource.resourceId, resource]));
    for (const resource of patch.resources ?? []) resources.set(resource.resourceId, resource);
    next.resources = [...resources.values()];
    const leases = new Map((next.resourceLeases ?? []).map((lease) => [lease.leaseId, lease]));
    for (const lease of patch.resourceLeases ?? []) leases.set(lease.leaseId, lease);
    next.resourceLeases = [...leases.values()];
    next.revision = patch.revision;
    return next;
};

const [byUnit, setByUnit] = createStore<Record<string, SurfaceViewState>>({});

const mountSnapshot = (unitId: string, snapshot: SurfaceSnapshot, generation = 0): void => {
    if (snapshot.protocolVersion !== SURFACE_PROTOCOL_VERSION) {
        throw new SurfaceStateError("invalid_snapshot", "Unsupported Surface protocol");
    }
    const errors = validateSurfaceNodeIds(snapshot.scene);
    if (errors.length > 0) throw new SurfaceStateError("invalid_snapshot", errors.join("; "));
    const current = byUnit[unitId];
    if (current && snapshot.revision < current.snapshot.revision) {
        throw new SurfaceStateError(
            "revision_conflict",
            `Surface snapshot revision ${snapshot.revision} is stale`,
        );
    }
    setByUnit(unitId, reconcile({
        snapshot: cloneSnapshot(snapshot),
        generation,
        previewRevision: current?.snapshot.instanceId === snapshot.instanceId
            ? current.previewRevision
            : 0,
        resultRevision: current?.snapshot.instanceId === snapshot.instanceId
            ? current.resultRevision
            : 0,
        lifecycle: current?.snapshot.instanceId === snapshot.instanceId
            ? current.lifecycle
            : "mounted",
        lifecycleRevision: current?.snapshot.instanceId === snapshot.instanceId
            ? current.lifecycleRevision
            : 1,
    }));
};

const applyPatch = (unitId: string, patch: SurfacePatch): void => {
    const current = byUnit[unitId];
    if (!current) {
        throw new SurfaceStateError("revision_conflict", "Surface snapshot is required before patches");
    }
    setByUnit(
        unitId,
        "snapshot",
        reconcile(applySurfacePatchToSnapshot(current.snapshot, patch)),
    );
};

const setGeneration = (unitId: string, generation: number): void => {
    if (!Number.isSafeInteger(generation) || generation < 0) {
        throw new SurfaceStateError("invalid_snapshot", "Surface generation must be non-negative");
    }
    if (byUnit[unitId]) setByUnit(unitId, "generation", generation);
};

const acceptPreviewCommit = (unitId: string, commit: SurfacePreviewCommit): boolean => {
    const current = byUnit[unitId];
    if (
        !current ||
        commit.protocolVersion !== SURFACE_PROTOCOL_VERSION ||
        commit.instanceId !== current.snapshot.instanceId ||
        commit.generation !== current.generation ||
        commit.previewRevision <= current.previewRevision
    ) {
        return false;
    }
    setByUnit(unitId, "previewRevision", commit.previewRevision);
    return true;
};

const acceptResultCommit = (unitId: string, commit: SurfaceResultCommit): boolean => {
    const current = byUnit[unitId];
    if (
        !current ||
        commit.protocolVersion !== SURFACE_PROTOCOL_VERSION ||
        commit.instanceId !== current.snapshot.instanceId ||
        commit.generation !== current.generation ||
        commit.resultRevision <= current.resultRevision
    ) {
        return false;
    }
    setByUnit(unitId, "resultRevision", commit.resultRevision);
    return true;
};

const applyLifecycle = (unitId: string, event: SurfaceLifecycleEvent): boolean => {
    const current = byUnit[unitId];
    if (
        !current ||
        event.protocolVersion !== SURFACE_PROTOCOL_VERSION ||
        event.instanceId !== current.snapshot.instanceId ||
        event.attachmentId !== current.snapshot.attachmentId ||
        event.revision < current.lifecycleRevision
    ) {
        return false;
    }
    if (event.revision === current.lifecycleRevision) {
        return event.state === current.lifecycle;
    }
    if (event.revision !== current.lifecycleRevision + 1) return false;
    setByUnit(unitId, "lifecycle", event.state);
    setByUnit(unitId, "lifecycleRevision", event.revision);
    return true;
};

const clear = (unitId: string): void => setByUnit(unitId, undefined!);
const clearAll = (): void => setByUnit(reconcile({}));

export const surfaceStore = {
    byUnit,
    actions: {
        mountSnapshot,
        applyPatch,
        setGeneration,
        acceptPreviewCommit,
        acceptResultCommit,
        applyLifecycle,
        clear,
        clearAll,
    },
};
