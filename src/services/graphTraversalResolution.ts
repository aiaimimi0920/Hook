/** Cycle-bounded traversal for graph images, formal outputs and pending state. */
import { DISABLED_PREFIX } from "../constants";
import type { Link, Unit } from "../types/unit";
import {
    findConnectedImageInput,
    getObjectField,
    hasOwn,
    isImageOutputPort,
} from "./imageGraphPrimitives";
import type { ArtCapability } from "./protocol";

export const isUnitFormalImagePending = (input: {
    units: readonly Unit[];
    links: readonly Link[];
    unitId: string;
    capabilities?: readonly ArtCapability[];
    visited?: Set<string>;
}): boolean => {
    const visited = input.visited ?? new Set<string>();
    if (visited.has(input.unitId)) return false;
    visited.add(input.unitId);

    const unit = input.units.find((candidate) => candidate.id === input.unitId);
    if (!unit) return false;
    if (unit.type === "art") {
        return unit.data.processing === true ||
            unit.data.nodeStatus === "running" ||
            unit.data.nodeStatus === "pending";
    }

    const relaysUpstream =
        unit.params?.image !== DISABLED_PREFIX &&
        unit.data.stickerEditPropagation?.acceptUpstream !== false &&
        !unit.data.stickerEditPropagation?.locallyEdited;
    if (!relaysUpstream) return false;

    const connectedInput = findConnectedImageInput(unit, input.links, input.capabilities);
    if (!connectedInput) return false;
    return isUnitFormalImagePending({
        ...input,
        unitId: connectedInput.fromUnitId,
        visited,
    });
};

export const resolveUnitOutputValue = (input: {
    units: readonly Unit[];
    links: readonly Link[];
    unitId: string;
    portId: string;
    capabilities?: readonly ArtCapability[];
    visited?: Set<string>;
}): unknown => {
    const visited = input.visited ?? new Set<string>();
    const visitKey = `${input.unitId}:${input.portId}`;
    if (visited.has(visitKey)) return undefined;
    visited.add(visitKey);

    const unit = input.units.find((item) => item.id === input.unitId);
    if (!unit) return undefined;

    const outputs = unit.data.outputs;
    if (outputs && hasOwn(outputs, input.portId)) {
        return outputs[input.portId];
    }

    if (input.portId !== "output" && outputs && hasOwn(outputs, "output")) {
        return outputs.output;
    }

    // An Art's visual preview and its output-port value are separate contracts.
    // Workflow Arts may publish a fast preview while their formal output is
    // still processing, so never expose previewSrc as an Art output fallback.
    if (unit.type === "art") {
        return undefined;
    }

    if (isImageOutputPort(unit, input.portId, input.capabilities)) {
        return resolveUnitImageFromGraph({
            units: input.units,
            links: input.links,
            capabilities: input.capabilities,
            unitId: input.unitId,
            visited,
        });
    }

    return undefined;
};

export const resolveConnectedUnitImageForPort = (input: {
    units: readonly Unit[];
    links: readonly Link[];
    unitId: string;
    portId: string;
    capabilities?: readonly ArtCapability[];
    visited?: Set<string>;
}): string | undefined => {
    const link = input.links.find(
        (candidate) =>
            candidate.toUnitId === input.unitId &&
            candidate.toPortId === input.portId,
    );
    if (!link) return undefined;

    const upstreamValue = resolveUnitOutputValue({
        units: input.units,
        links: input.links,
        capabilities: input.capabilities,
        unitId: link.fromUnitId,
        portId: link.fromPortId || "output",
        visited: input.visited,
    });
    const directValue =
        getObjectField(upstreamValue, ["value", "data", "src", "previewSrc", "url", "path"]) ??
        upstreamValue;

    return typeof directValue === "string" && directValue.length > 0 ? directValue : undefined;
};

export const resolveUnitImageFromGraph = (input: {
    units: readonly Unit[];
    links: readonly Link[];
    unitId: string;
    capabilities?: readonly ArtCapability[];
    visited?: Set<string>;
}): string | undefined => {
    const visited = input.visited ?? new Set<string>();
    if (visited.has(input.unitId)) return undefined;
    visited.add(input.unitId);

    const unit = input.units.find((item) => item.id === input.unitId);
    if (!unit) return undefined;

    if (unit.type === "sticker") {
        const imageInputDisabled = unit.params?.image === DISABLED_PREFIX;
        const relaysUpstream =
            unit.data.stickerEditPropagation?.acceptUpstream !== false &&
            !unit.data.stickerEditPropagation?.locallyEdited;
        if (!imageInputDisabled && relaysUpstream) {
            const connectedInput = findConnectedImageInput(unit, input.links, input.capabilities);
            if (connectedInput) {
                const upstream = resolveConnectedUnitImageForPort({
                    units: input.units,
                    links: input.links,
                    capabilities: input.capabilities,
                    unitId: unit.id,
                    portId: connectedInput.toPortId,
                    visited,
                });
                if (upstream) return upstream;
            }

            const manualImage = unit.params?.image_path;
            if (typeof manualImage === "string" && manualImage.startsWith("data:")) {
                return manualImage;
            }
        }

        return unit.data.previewSrc || unit.data.src;
    }

    if (unit.data.previewSrc) return unit.data.previewSrc;

    const connectedInput = findConnectedImageInput(unit, input.links, input.capabilities);
    if (connectedInput) {
        const upstream = resolveUnitImageFromGraph({
            ...input,
            unitId: connectedInput.fromUnitId,
            visited,
        });
        if (upstream) return upstream;
    }

    return unit.data.src;
};
