/** Shared image-port, capability and object-value primitives for graph resolvers. */
import type { Link, Unit } from "../types/unit";
import { findArtCapability } from "./artCapabilityLookup";
import type { ArtCapability } from "./protocol";

const DEFAULT_IMAGE_INPUTS = ["image", "input_image", "input"];

export const isImageLikePort = (name?: string, type?: string) => {
    const normalizedName = (name || "").toLowerCase();
    const normalizedType = (type || "").toLowerCase();

    return (
        normalizedType.includes("image") ||
        DEFAULT_IMAGE_INPUTS.includes(normalizedName) ||
        normalizedName.endsWith("_image") ||
        normalizedName.endsWith("_file")
    );
};

export const isNonEmptyString = (value: string | undefined): value is string =>
    typeof value === "string" && value.length > 0;

export const getImageInputNames = (unit: Unit, capabilities?: readonly ArtCapability[]) => {
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

export const findConnectedImageInput = (
    unit: Unit,
    links: readonly Link[],
    capabilities?: readonly ArtCapability[],
) => {
    const imageInputs = new Set(getImageInputNames(unit, capabilities));
    return links.find((link) => link.toUnitId === unit.id && imageInputs.has(link.toPortId));
};

const imageOutputAliases = new Set(["output", "output_image", "image", "result", "preview"]);

export const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

export const getOwnValue = (record: Record<string, unknown>, key: string) =>
    hasOwn(record, key) ? record[key] : undefined;

/** Defines dynamic graph keys as data even when a key is named `__proto__`. */
export const setOwnEnumerableValue = <Value>(
    record: Record<string, Value>,
    key: string,
    value: Value,
) => {
    Object.defineProperty(record, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
    });
};

export const findCapability = (unit: Unit, capabilities?: readonly ArtCapability[]) =>
    unit.type === "art" && capabilities
        ? findArtCapability(capabilities, unit.artId)
        : undefined;

export const isImageOutputPort = (unit: Unit, portId: string, capabilities?: readonly ArtCapability[]) => {
    const normalized = portId.toLowerCase();
    if (imageOutputAliases.has(normalized)) return true;

    const capability = findCapability(unit, capabilities);
    const capabilityPort = capability?.outputs?.find((port) => port.name === portId);
    if (capabilityPort && isImageLikePort(capabilityPort.name, capabilityPort.type)) return true;

    const unitPort = unit.outputs?.find((port) => port.id === portId || port.label === portId);
    return !!unitPort && isImageLikePort(unitPort.id || unitPort.label, unitPort.type);
};

export const isPrimaryImageInputName = (name: string) => DEFAULT_IMAGE_INPUTS.includes(name.toLowerCase());

export const getObjectField = (value: unknown, fields: readonly string[]) => {
    if (!value || typeof value !== "object") return undefined;
    const record = value as Record<string, unknown>;
    for (const field of fields) {
        if (hasOwn(record, field) && record[field] !== undefined && record[field] !== null) {
            return record[field];
        }
    }
    return undefined;
};
