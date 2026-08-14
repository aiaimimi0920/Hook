import { DISABLED_PREFIX } from "../constants";
import type { ArtCapability, ArtParam } from "./protocol";
import type { Link, Unit } from "../types/unit";
import { findArtCapability } from "./artCapabilityLookup";

const DEFAULT_IMAGE_INPUTS = ["image", "input_image", "input"];

const isImageLikePort = (name?: string, type?: string) => {
    const normalizedName = (name || "").toLowerCase();
    const normalizedType = (type || "").toLowerCase();

    return (
        normalizedType.includes("image") ||
        DEFAULT_IMAGE_INPUTS.includes(normalizedName) ||
        normalizedName.endsWith("_image") ||
        normalizedName.endsWith("_file")
    );
};

const isNonEmptyString = (value: string | undefined): value is string =>
    typeof value === "string" && value.length > 0;

const getImageInputNames = (unit: Unit, capabilities?: readonly ArtCapability[]) => {
    if (unit.type === "art") {
        const capability = capabilities ? findArtCapability(capabilities, unit.artId) : undefined;
        if (capability?.inputs !== undefined) {
            return capability.inputs
                ?.filter((input) => isImageLikePort(input.name, input.type))
                .map((input) => input.name)
                .filter(isNonEmptyString) || [];
        }

        return (
            unit.inputs
                ?.filter((input) => isImageLikePort(input.id || input.label, input.type))
                .map((input) => input.id || input.label)
                .filter(isNonEmptyString) || []
        );
    }

    const unitInputs =
        unit.inputs
            ?.filter((input) => isImageLikePort(input.id || input.label, input.type))
            .map((input) => input.id || input.label)
            .filter(isNonEmptyString) || [];
    return unitInputs.length > 0 ? unitInputs : ["image"];
};

const findConnectedImageInput = (unit: Unit, links: readonly Link[], capabilities?: readonly ArtCapability[]) => {
    const imageInputs = new Set(getImageInputNames(unit, capabilities));
    return links.find((link) => link.toUnitId === unit.id && imageInputs.has(link.toPortId));
};

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

const imageOutputAliases = new Set(["output", "output_image", "image", "result", "preview"]);

const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

const findCapability = (unit: Unit, capabilities?: readonly ArtCapability[]) =>
    unit.type === "art" && capabilities
        ? findArtCapability(capabilities, unit.artId)
        : undefined;

const isImageOutputPort = (unit: Unit, portId: string, capabilities?: readonly ArtCapability[]) => {
    const normalized = portId.toLowerCase();
    if (imageOutputAliases.has(normalized)) return true;

    const capability = findCapability(unit, capabilities);
    const capabilityPort = capability?.outputs?.find((port) => port.name === portId);
    if (capabilityPort && isImageLikePort(capabilityPort.name, capabilityPort.type)) return true;

    const unitPort = unit.outputs?.find((port) => port.id === portId || port.label === portId);
    return !!unitPort && isImageLikePort(unitPort.id || unitPort.label, unitPort.type);
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

const isPrimaryImageInputName = (name: string) => DEFAULT_IMAGE_INPUTS.includes(name.toLowerCase());

const toFiniteNumber = (value: unknown) => {
    const numeric = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
};

const clampParamNumber = (value: number, param: ArtParam) => {
    let next = value;
    if (typeof param.min === "number" && Number.isFinite(param.min)) next = Math.max(param.min, next);
    if (typeof param.max === "number" && Number.isFinite(param.max)) next = Math.min(param.max, next);
    return next;
};

const coerceBooleanParam = (value: unknown) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["true", "1", "yes", "on"].includes(normalized)) return true;
        if (["false", "0", "no", "off"].includes(normalized)) return false;
    }
    return undefined;
};

const getObjectField = (value: unknown, fields: readonly string[]) => {
    if (!value || typeof value !== "object") return undefined;
    const record = value as Record<string, unknown>;
    for (const field of fields) {
        if (hasOwn(record, field) && record[field] !== undefined && record[field] !== null) {
            return record[field];
        }
    }
    return undefined;
};

const coerceLinkedParamValue = (param: ArtParam, value: unknown) => {
    const widget = (param.widget || "").toLowerCase();
    const directValue = getObjectField(value, ["value", "data", "src", "previewSrc", "url", "path"]) ?? value;

    if (widget === "slider" || widget === "number") {
        const numeric = toFiniteNumber(directValue);
        return numeric === undefined ? undefined : clampParamNumber(numeric, param);
    }

    if (widget === "checkbox" || widget === "switch") {
        return coerceBooleanParam(directValue);
    }

    if (widget === "image_link" || widget === "file") {
        return typeof directValue === "string" && directValue.length > 0 ? directValue : undefined;
    }

    if (widget === "text" || widget === "color") {
        return typeof directValue === "string" ? directValue : String(directValue);
    }

    return directValue;
};

export const resolveEffectiveNodeParams = (input: {
    units: readonly Unit[];
    links: readonly Link[];
    unitId: string;
    capabilities?: readonly ArtCapability[];
    manualParams?: Record<string, unknown>;
}): Record<string, unknown> => {
    const unit = input.units.find((item) => item.id === input.unitId);
    if (!unit) return {};

    const capability = findCapability(unit, input.capabilities);
    const manual = input.manualParams || unit.params || {};
    const resolved: Record<string, unknown> = {};
    const paramById = new Map<string, ArtParam>();
    const secretParamIds = new Set<string>();

    capability?.params?.forEach((param) => {
        if (param.secret) {
            secretParamIds.add(param.id);
            return;
        }
        paramById.set(param.id, param);
        resolved[param.id] = manual[param.id] ?? param.default;
    });

    Object.entries(manual).forEach(([key, value]) => {
        if (secretParamIds.has(key)) return;
        resolved[key] = value;
    });

    input.links
        .filter((link) => link.toUnitId === input.unitId)
        .forEach((link) => {
            const param = paramById.get(link.toPortId);
            if (!param || manual[param.id] === DISABLED_PREFIX) return;

            const upstreamValue = resolveUnitOutputValue({
                units: input.units,
                links: input.links,
                capabilities: input.capabilities,
                unitId: link.fromUnitId,
                portId: link.fromPortId || "output",
            });
            if (upstreamValue === undefined || upstreamValue === null) return;

            const coerced = coerceLinkedParamValue(param, upstreamValue);
            if (coerced !== undefined) {
                resolved[param.id] = coerced;
            }
        });

    return resolved;
};

export const resolveAuxiliaryUnitExecutionInputImages = (input: {
    units: readonly Unit[];
    links: readonly Link[];
    unitId: string;
    capabilities?: readonly ArtCapability[];
    manualParams?: Record<string, unknown>;
}): Record<string, string> => {
    const unit = input.units.find((item) => item.id === input.unitId);
    if (!unit) return {};

    const capability = findCapability(unit, input.capabilities);
    const manual = input.manualParams || unit.params || {};
    const auxiliaryImageInputs =
        capability?.inputs?.filter(
            (port) =>
                isNonEmptyString(port.name) &&
                isImageLikePort(port.name, port.type) &&
                !isPrimaryImageInputName(port.name),
        ) || [];

    const resolved: Record<string, string> = {};

    for (const port of auxiliaryImageInputs) {
        const connected = resolveConnectedUnitImageForPort({
            units: input.units,
            links: input.links,
            capabilities: input.capabilities,
            unitId: input.unitId,
            portId: port.name,
        });
        if (connected) {
            resolved[port.name] = connected;
            continue;
        }

        const manualValue = manual[port.name];
        if (typeof manualValue === "string" && manualValue.length > 0) {
            resolved[port.name] = manualValue;
        }
    }

    return resolved;
};

export const resolveUnitExecutionImageInputs = (input: {
    units: readonly Unit[];
    links: readonly Link[];
    unitId: string;
    capabilities?: readonly ArtCapability[];
    manualParams?: Record<string, unknown>;
}): Record<string, string> => {
    const unit = input.units.find((item) => item.id === input.unitId);
    if (!unit) return {};
    const manual = input.manualParams || unit.params || {};
    const ports = getImageInputNames(unit, input.capabilities);
    const resolved: Record<string, string> = {};

    for (const portId of ports) {
        const connected = resolveConnectedUnitImageForPort({
            units: input.units,
            links: input.links,
            capabilities: input.capabilities,
            unitId: input.unitId,
            portId,
        });
        if (connected) {
            resolved[portId] = connected;
            continue;
        }
        const manualValue = manual[portId];
        if (typeof manualValue === "string" && manualValue.length > 0) {
            resolved[portId] = manualValue;
        }
    }

    return resolved;
};

const collectDeclaredExecutionImagePorts = (input: {
    unit: Unit;
    links: readonly Link[];
    manualParams: Record<string, unknown>;
    capabilities?: readonly ArtCapability[];
}) => {
    const capability = findCapability(input.unit, input.capabilities);
    const declared = new Set<string>();

    const capabilityImagePorts =
        capability?.inputs
            ?.filter((port) => isNonEmptyString(port.name) && isImageLikePort(port.name, port.type))
            .map((port) => port.name)
            .filter(isNonEmptyString) || [];
    capabilityImagePorts.forEach((port) => declared.add(port));

    if (capability?.inputs === undefined) {
        input.unit.inputs
            ?.filter((port) => isImageLikePort(port.id || port.label, port.type))
            .map((port) => port.id || port.label)
            .filter(isNonEmptyString)
            .forEach((port) => declared.add(port));
    }

    const ports = Array.from(declared);
    const primaryPortId =
        ports.find((port) => isPrimaryImageInputName(port)) ||
        ports[0];
    const auxiliaryPortIds = ports.filter((port) => port !== primaryPortId);

    return {
        primaryPortId,
        auxiliaryPortIds,
    };
};

export const resolveMissingUnitExecutionImagePorts = (input: {
    units: readonly Unit[];
    links: readonly Link[];
    unitId: string;
    capabilities?: readonly ArtCapability[];
    manualParams?: Record<string, unknown>;
}): string[] => {
    const unit = input.units.find((item) => item.id === input.unitId);
    if (!unit) return [];

    const manual = input.manualParams || unit.params || {};
    const declared = collectDeclaredExecutionImagePorts({
        unit,
        links: input.links,
        manualParams: manual,
        capabilities: input.capabilities,
    });
    if (!declared.primaryPortId && declared.auxiliaryPortIds.length === 0) {
        return [];
    }

    const missing: string[] = [];
    if (declared.primaryPortId) {
        const primaryValue = isPrimaryImageInputName(declared.primaryPortId)
            ? resolveUnitExecutionInputImage({
                  units: input.units,
                  links: input.links,
                  unitId: input.unitId,
                  capabilities: input.capabilities,
              })
            : resolveConnectedUnitImageForPort({
                  units: input.units,
                  links: input.links,
                  unitId: input.unitId,
                  portId: declared.primaryPortId,
                  capabilities: input.capabilities,
              });
        if (!primaryValue) {
            missing.push(declared.primaryPortId);
        }
    }

    const auxiliaryValues = resolveAuxiliaryUnitExecutionInputImages(input);
    declared.auxiliaryPortIds.forEach((portId) => {
        if (!auxiliaryValues[portId]) {
            missing.push(portId);
        }
    });

    return missing;
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

/**
 * Canvas display-image resolver. Art nodes own their generated preview, while
 * an untouched sticker is a transparent image relay and resolves its connected
 * source before any cached local preview. A locally edited sticker remains a
 * real image boundary and therefore keeps its own preview priority.
 */
export const resolveCanvasDisplayImage = (input: {
    units: readonly Unit[];
    links: readonly Link[];
    unitId: string;
    visited?: Set<string>;
}): string | undefined => {
    const visited = input.visited ?? new Set<string>();
    // Loop Detection
    if (visited.has(input.unitId)) return undefined;
    visited.add(input.unitId);

    const unit = input.units.find((item) => item.id === input.unitId);
    if (!unit) return undefined;

    const link = input.links.find(
        (l) =>
            l.toUnitId === input.unitId &&
            (l.toPortId === "image" || l.toPortId === "input_image" || l.toPortId === "input"),
    );

    const stickerInputEnabled =
        unit.type !== "sticker" || unit.params?.image !== DISABLED_PREFIX;
    const isTransparentStickerRelay =
        unit.type === "sticker" &&
        stickerInputEnabled &&
        unit.data.stickerEditPropagation?.acceptUpstream !== false &&
        !unit.data.stickerEditPropagation?.locallyEdited;

    const connectedOutput = () =>
        link
            ? resolveConnectedUnitImageForPort({
                  units: input.units,
                  links: input.links,
                  unitId: unit.id,
                  portId: link.toPortId,
                  visited,
              })
            : undefined;

    if (isTransparentStickerRelay && link) {
        const upstream = connectedOutput();
        if (upstream) return upstream;
    }

    if (unit.data.previewSrc) {
        return unit.data.previewSrc;
    }

    if (!isTransparentStickerRelay && stickerInputEnabled && link) {
        const upstream = connectedOutput();
        if (upstream) return upstream;
    }

    return unit.data.src;
};

export const resolveUnitExecutionInputImage = (input: {
    units: readonly Unit[];
    links: readonly Link[];
    unitId: string;
    capabilities?: readonly ArtCapability[];
}): string | undefined => {
    const unit = input.units.find((item) => item.id === input.unitId);
    if (!unit) return undefined;

    const connectedInput = findConnectedImageInput(unit, input.links, input.capabilities);
    if (!connectedInput) {
        return unit.type === "sticker"
            ? resolveUnitImageFromGraph(input)
            : undefined;
    }

    return resolveConnectedUnitImageForPort({
        units: input.units,
        links: input.links,
        capabilities: input.capabilities,
        unitId: unit.id,
        portId: connectedInput.toPortId,
    });
};
