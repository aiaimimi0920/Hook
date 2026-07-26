// Pure workflow-snapshot instantiation.
//
// Extracted from app.tsx's instantiateWorkflowSnapshot: the transform that turns
// an incoming ArtLoom workflow snapshot into local `Unit`/`Link` records (with
// reference-mode reuse of existing units, port synthesis, execution-config
// derivation, and geometry/opacity defaults), plus the two branchy merge
// reducers used to fold the result into the graph store.
//
// Non-deterministic and side-effecting concerns stay in app.tsx and are injected
// here: `newId` (crypto.randomUUID), the current `existingUnits`, and the art
// `capabilities`. The store writes and follow-up sync remain in the caller.

import type { ArtCapability } from "./protocol";
import type { Link, Unit } from "../types/unit";
import type { WorkflowSnapshotPayload } from "./workflowPayload";
import { buildUnitPortsFromCapability } from "./artNodeFactory";
import { deriveUnitExecutionConfig } from "./nodeExecutionConfig";

export interface WorkflowInstantiationDeps {
    /** Current graph units, used to reuse ids for reference-mode re-instantiation. */
    existingUnits: readonly Unit[];
    /** Art capabilities, used to synthesize ports and execution defaults. */
    capabilities: readonly ArtCapability[];
    /** Fresh id generator (injected so tests are deterministic). */
    newId: () => string;
}

export interface WorkflowInstantiation {
    units: Unit[];
    links: Link[];
    referencedLocalIds: Set<string>;
}

/**
 * Builds the units/links to instantiate from a workflow snapshot. Returns null
 * when there is nothing to instantiate (empty node list), matching the caller's
 * early return.
 */
export const buildWorkflowInstantiation = (
    payload: WorkflowSnapshotPayload,
    deps: WorkflowInstantiationDeps,
): WorkflowInstantiation | null => {
    const incomingNodes = payload.nodes;
    const incomingEdges = payload.edges;
    if (incomingNodes.length === 0) return null;

    const isReferenceMode = payload.mode === "reference" && !!payload.workflow_id;
    const incomingOriginNodeIds = new Set(
        incomingNodes
            .map((node) => (typeof node.id === "string" ? node.id : undefined))
            .filter((nodeId): nodeId is string => !!nodeId),
    );
    const existingReferenceUnitsByOrigin = new Map<string, Unit>();
    if (isReferenceMode) {
        deps.existingUnits.forEach((unit) => {
            const originWorkflowId = unit.data?.originWorkflowId;
            const originNodeId = unit.data?.originNodeId;
            if (
                originWorkflowId === payload.workflow_id &&
                originNodeId &&
                incomingOriginNodeIds.has(originNodeId)
            ) {
                existingReferenceUnitsByOrigin.set(originNodeId, unit);
            }
        });
    }

    const idMap = new Map<string, string>();
    incomingNodes.forEach((node) => {
        const existingUnit =
            isReferenceMode && typeof node.id === "string"
                ? existingReferenceUnitsByOrigin.get(node.id)
                : undefined;
        idMap.set(node.id, existingUnit?.id || deps.newId());
    });

    const instantiatedUnits: Unit[] = incomingNodes.map((node) => {
        const localId = idMap.get(node.id)!;
        const nodeType: "sticker" | "art" = node.type === "sticker" ? "sticker" : "art";
        const artId = node.data?.artId || node.data?.art_id || undefined;
        const capability = deps.capabilities.find((item) => item.id === artId);
        const { inputs, outputs } = buildUnitPortsFromCapability(nodeType, capability);
        const executionConfig = deriveUnitExecutionConfig({
            capability,
            explicitConfig: node.data?.executionConfig,
        });

        return {
            id: localId,
            type: nodeType,
            artId,
            x: node.position?.x ?? 0,
            y: node.position?.y ?? 0,
            w: node.data?.w ?? node.measured?.width ?? 240,
            h: node.data?.h ?? node.measured?.height ?? 180,
            params: node.data?.params || {},
            inputs,
            outputs,
            data: {
                src: node.data?.src,
                previewSrc: node.data?.previewSrc,
                rasterizedAnnotationLayerSrc: node.data?.rasterizedAnnotationLayerSrc,
                minified: node.data?.minified ?? false,
                savedRect: node.data?.savedRect,
                cropOffset: node.data?.cropOffset,
                opacityNormal: node.data?.opacityNormal ?? 1,
                opacityMini: node.data?.opacityMini ?? 0.9,
                executionConfig,
                originWorkflowId: isReferenceMode ? payload.workflow_id || undefined : undefined,
                originNodeId: isReferenceMode ? node.id : undefined,
            },
        };
    });

    const instantiatedLinks: Link[] = incomingEdges
        .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
        .map((edge) => ({
            id: deps.newId(),
            fromUnitId: idMap.get(edge.source)!,
            fromPortId: edge.sourceHandle || "output",
            toUnitId: idMap.get(edge.target)!,
            toPortId: edge.targetHandle || "input",
        }));

    const referencedLocalIds = new Set(instantiatedUnits.map((unit) => unit.id));

    return { units: instantiatedUnits, links: instantiatedLinks, referencedLocalIds };
};

const linkKey = (link: Link) =>
    `${link.fromUnitId}::${link.fromPortId || ""}::${link.toUnitId}::${link.toPortId || ""}`;

/** Upserts instantiated units into the previous unit list, replacing by id. */
export const mergeInstantiatedUnits = (prev: readonly Unit[], units: readonly Unit[]): Unit[] => {
    const nextById = new Map(prev.map((unit) => [unit.id, unit] as const));
    units.forEach((unit) => {
        nextById.set(unit.id, unit);
    });
    return Array.from(nextById.values());
};

/**
 * Replaces links among the (re-)instantiated units and appends the new links,
 * de-duplicated by from/port/to/port. Any previous link whose BOTH endpoints are
 * re-instantiated is dropped first, so a re-instantiation cannot leave stale
 * duplicate edges between the same nodes.
 */
export const mergeInstantiatedLinks = (
    prev: readonly Link[],
    links: readonly Link[],
    referencedLocalIds: ReadonlySet<string>,
): Link[] => {
    const next = prev.filter(
        (link) => !(referencedLocalIds.has(link.fromUnitId) && referencedLocalIds.has(link.toUnitId)),
    );
    const seen = new Set(next.map(linkKey));
    links.forEach((link) => {
        const key = linkKey(link);
        if (!seen.has(key)) {
            seen.add(key);
            next.push(link);
        }
    });
    return next;
};
