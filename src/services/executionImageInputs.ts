/** Declared primary/auxiliary image inputs and missing-port resolution for execution. */
import type { Link, Unit } from "../types/unit";
import {
    findCapability,
    findConnectedImageInput,
    getImageInputNames,
    getOwnValue,
    isImageLikePort,
    isNonEmptyString,
    isPrimaryImageInputName,
    setOwnEnumerableValue,
} from "./imageGraphPrimitives";
import type { ArtCapability } from "./protocol";
import {
    resolveConnectedUnitImageForPort,
    resolveUnitImageFromGraph,
} from "./graphTraversalResolution";

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
            setOwnEnumerableValue(resolved, port.name, connected);
            continue;
        }

        const manualValue = getOwnValue(manual, port.name);
        if (typeof manualValue === "string" && manualValue.length > 0) {
            setOwnEnumerableValue(resolved, port.name, manualValue);
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
            setOwnEnumerableValue(resolved, portId, connected);
            continue;
        }
        const manualValue = getOwnValue(manual, portId);
        if (typeof manualValue === "string" && manualValue.length > 0) {
            setOwnEnumerableValue(resolved, portId, manualValue);
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
        if (!getOwnValue(auxiliaryValues, portId)) {
            missing.push(portId);
        }
    });

    return missing;
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
