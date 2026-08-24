/** Effective Art parameter resolution without exposing secret/control parameters. */
import { DISABLED_PREFIX, isInternalArtControlParam } from "../constants";
import type { Link, Unit } from "../types/unit";
import {
    findCapability,
    getObjectField,
    getOwnValue,
    setOwnEnumerableValue,
} from "./imageGraphPrimitives";
import type { ArtCapability, ArtParam } from "./protocol";
import { resolveUnitOutputValue } from "./graphTraversalResolution";

const toFiniteNumber = (value: unknown) => {
    const numeric = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
};

const TRUE_BOOLEAN_VALUES = new Set(["true", "1", "yes", "on"]);
const FALSE_BOOLEAN_VALUES = new Set(["false", "0", "no", "off"]);

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
        if (TRUE_BOOLEAN_VALUES.has(normalized)) return true;
        if (FALSE_BOOLEAN_VALUES.has(normalized)) return false;
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
        if (param.secret || isInternalArtControlParam(param.id)) {
            if (param.secret) secretParamIds.add(param.id);
            return;
        }
        paramById.set(param.id, param);
        setOwnEnumerableValue(resolved, param.id, getOwnValue(manual, param.id) ?? param.default);
    });

    Object.entries(manual).forEach(([key, value]) => {
        if (secretParamIds.has(key) || isInternalArtControlParam(key)) return;
        setOwnEnumerableValue(resolved, key, value);
    });

    for (const link of input.links) {
        if (link.toUnitId !== input.unitId) continue;
        const param = paramById.get(link.toPortId);
        if (!param || getOwnValue(manual, param.id) === DISABLED_PREFIX) continue;

        const upstreamValue = resolveUnitOutputValue({
            units: input.units,
            links: input.links,
            capabilities: input.capabilities,
            unitId: link.fromUnitId,
            portId: link.fromPortId || "output",
        });
        if (upstreamValue === undefined || upstreamValue === null) continue;

        const coerced = coerceLinkedParamValue(param, upstreamValue);
        if (coerced !== undefined) {
            setOwnEnumerableValue(resolved, param.id, coerced);
        }
    }

    return resolved;
};
