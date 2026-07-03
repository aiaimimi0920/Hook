import { DISABLED_PREFIX } from "../constants";
import type { ArtCapability, ArtParam } from "./protocol";
import type { Link, Unit } from "../types/unit";

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

const mergeLegacyImageInputAliases = (imageInputs: string[], allInputs: string[]) => {
    const allInputNames = new Set(allInputs.filter(Boolean));
    const imageInputNames = new Set(imageInputs.filter(Boolean));

    for (const alias of DEFAULT_IMAGE_INPUTS) {
        if (!allInputNames.has(alias) || imageInputNames.has(alias)) {
            imageInputNames.add(alias);
        }
    }

    return Array.from(imageInputNames);
};

const getImageInputNames = (unit: Unit, capabilities?: readonly ArtCapability[]) => {
    if (unit.type === "art") {
        const capability = capabilities?.find((item) => item.id === unit.artId);
        const allInputs = capability?.inputs?.map((input) => input.name).filter(isNonEmptyString) || [];
        const imageInputs =
            capability?.inputs
                ?.filter((input) => isImageLikePort(input.name, input.type))
                .map((input) => input.name)
                .filter(isNonEmptyString) || [];
        return imageInputs.length > 0 ? mergeLegacyImageInputAliases(imageInputs, allInputs) : DEFAULT_IMAGE_INPUTS;
    }

    const allInputs = unit.inputs?.map((input) => input.id || input.label).filter(isNonEmptyString) || [];
    const unitInputs =
        unit.inputs
            ?.filter((input) => isImageLikePort(input.id || input.label, input.type))
            .map((input) => input.id || input.label)
            .filter(isNonEmptyString) || [];
    return unitInputs.length > 0 ? mergeLegacyImageInputAliases(unitInputs, allInputs) : ["image"];
};

const findConnectedImageInput = (unit: Unit, links: readonly Link[], capabilities?: readonly ArtCapability[]) => {
    const imageInputs = new Set(getImageInputNames(unit, capabilities));
    return links.find((link) => link.toUnitId === unit.id && imageInputs.has(link.toPortId));
};

const imageOutputAliases = new Set(["output", "output_image", "image", "result", "preview"]);

const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

const findCapability = (unit: Unit, capabilities?: readonly ArtCapability[]) =>
    unit.type === "art" ? capabilities?.find((item) => item.id === unit.artId) : undefined;

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

    if (isImageOutputPort(unit, input.portId, input.capabilities)) {
        return resolveUnitImageFromGraph({
            units: input.units,
            links: input.links,
            capabilities: input.capabilities,
            unitId: input.unitId,
        });
    }

    return undefined;
};

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

    capability?.params?.forEach((param) => {
        paramById.set(param.id, param);
        resolved[param.id] = manual[param.id] ?? param.default;
    });

    Object.entries(manual).forEach(([key, value]) => {
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
        if (!imageInputDisabled) {
            const connectedInput = findConnectedImageInput(unit, input.links, input.capabilities);
            if (connectedInput) {
                const upstream = resolveUnitImageFromGraph({
                    ...input,
                    unitId: connectedInput.fromUnitId,
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

    return resolveUnitImageFromGraph({
        units: input.units,
        links: input.links,
        capabilities: input.capabilities,
        unitId: connectedInput.fromUnitId,
    });
};
