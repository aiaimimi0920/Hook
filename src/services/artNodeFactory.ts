import type { ArtCapability } from "./protocol";
import type { Unit } from "../types/unit";
import { getCapabilityInputsForPorts } from "./artPorts";
import { deriveUnitExecutionConfig } from "./nodeExecutionConfig";

const DEFAULT_ART_NODE_SIZE = { w: 320, h: 240 };

type CapabilityInput = NonNullable<ArtCapability["inputs"]>[number];
type CapabilityOutput = NonNullable<ArtCapability["outputs"]>[number];

const getSchemaProperties = (capability: ArtCapability): Record<string, unknown> => {
    const execution = capability.execution as Record<string, unknown> | undefined;
    const schema = (execution?.input_schema || execution?.inputSchema) as Record<string, unknown> | undefined;
    const properties = schema?.properties;
    return properties && typeof properties === "object" ? properties as Record<string, unknown> : {};
};

const schemaType = (schema: unknown): string | undefined => {
    if (!schema || typeof schema !== "object") return undefined;
    const record = schema as Record<string, unknown>;
    if (typeof record.type === "string") return record.type.toLowerCase();
    if (Array.isArray(record.type)) {
        const concrete = record.type.find((item) => typeof item === "string" && item !== "null");
        if (typeof concrete === "string") return concrete.toLowerCase();
    }

    for (const unionKey of ["anyOf", "oneOf", "allOf"]) {
        const options = record[unionKey];
        if (!Array.isArray(options)) continue;
        for (const option of options) {
            const nested = schemaType(option);
            if (nested && nested !== "null") return nested;
        }
    }

    return undefined;
};

const coerceStringDefault = (raw: string, typeHint: string | undefined): unknown => {
    const normalizedType = (typeHint || "").toLowerCase();
    const trimmed = raw.trim();
    if (!trimmed) return raw;

    if (["number", "integer", "float", "int", "double"].some((type) => normalizedType.includes(type))) {
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) ? parsed : raw;
    }

    if (["boolean", "bool"].some((type) => normalizedType.includes(type))) {
        if (trimmed.toLowerCase() === "true") return true;
        if (trimmed.toLowerCase() === "false") return false;
    }

    return raw;
};

const coerceDefaultParamValue = (
    capability: ArtCapability,
    param: NonNullable<ArtCapability["params"]>[number],
): unknown => {
    const value = param.default;
    if (typeof value !== "string") return value;

    const properties = getSchemaProperties(capability);
    const matchingInput = (capability.inputs || []).find((input) => input.name === param.id);
    const schemaHint = schemaType(properties[param.id]);
    const inputHint = matchingInput?.type || matchingInput?.execution_type || matchingInput?.data_type;
    const paramHint = param.data_type || param.widget;

    return coerceStringDefault(value, schemaHint || inputHint || paramHint);
};

const toUnitPortType = (type: string | undefined): Unit["inputs"][number]["type"] => {
    const normalized = (type || "any").toLowerCase();
    if (normalized.includes("image")) return "image";
    if (normalized.includes("number") || normalized.includes("integer") || normalized.includes("float")) return "number";
    if (normalized.includes("boolean") || normalized.includes("bool")) return "boolean";
    if (normalized.includes("text") || normalized.includes("string")) return "text";
    return "any";
};

const inputToUnitPort = (input: CapabilityInput): Unit["inputs"][number] => ({
    id: input.name,
    type: toUnitPortType(input.type),
    direction: "input",
    label: input.label,
});

const outputToUnitPort = (output: CapabilityOutput): Unit["outputs"][number] => ({
    id: output.name,
    type: toUnitPortType(output.type),
    direction: "output",
    label: output.label,
});

export const buildUnitPortsFromCapability = (
    type: "sticker" | "art",
    capability?: ArtCapability,
): Pick<Unit, "inputs" | "outputs"> => {
    if (type === "sticker") {
        return {
            inputs: [{ id: "image", type: "image", direction: "input", label: "Image" }],
            outputs: [{ id: "output_image", type: "image", direction: "output", label: "Image" }],
        };
    }

    const inputs = getCapabilityInputsForPorts(
        capability,
        [{ name: "input_image", label: "Input", type: "image" }],
    ).map(inputToUnitPort);
    const outputs = (capability?.outputs || [{ name: "output_image", label: "Image", type: "image" }])
        .map(outputToUnitPort);

    return { inputs, outputs };
};

export const buildDefaultParamsFromCapability = (capability: ArtCapability): Record<string, unknown> => {
    const params: Record<string, unknown> = {};
    for (const param of capability.params || []) {
        params[param.id] = coerceDefaultParamValue(capability, param);
    }
    return params;
};

export const buildStandaloneArtNodeUnit = (input: {
    id: string;
    capability: ArtCapability;
    x: number;
    y: number;
    w?: number;
    h?: number;
}): Unit => {
    const { inputs, outputs } = buildUnitPortsFromCapability("art", input.capability);
    return {
        id: input.id,
        type: "art",
        artId: input.capability.id,
        x: input.x,
        y: input.y,
        w: input.w ?? DEFAULT_ART_NODE_SIZE.w,
        h: input.h ?? DEFAULT_ART_NODE_SIZE.h,
        params: buildDefaultParamsFromCapability(input.capability),
        inputs,
        outputs,
        data: {
            executionConfig: deriveUnitExecutionConfig({
                capability: input.capability,
            }),
        },
    };
};
