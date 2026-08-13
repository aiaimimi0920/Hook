import type {
    ArtCapability,
    ArtCapabilityMetadata,
    ArtParam,
    ArtParamOption,
    ArtPortDefinition,
    TransportMode,
} from "./protocol";

type JsonRecord = Record<string, unknown>;

const DEFAULT_TRANSPORTS: TransportMode[] = ["shared_memory"];
const TRANSPORT_MODES = new Set<TransportMode>([
    "websocket",
    "shared_memory",
    "cloudflare_relay",
]);

const isRecord = (value: unknown): value is JsonRecord =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const hasOwn = (value: JsonRecord, key: string) =>
    Object.prototype.hasOwnProperty.call(value, key);

const stringValue = (value: JsonRecord, key: string): string | undefined => {
    const candidate = value[key];
    return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
};

const optionalBoolean = (value: JsonRecord, key: string): boolean | undefined => {
    const candidate = value[key];
    return typeof candidate === "boolean" ? candidate : undefined;
};

const optionalFiniteNumber = (value: JsonRecord, key: string): number | undefined => {
    const candidate = value[key];
    return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
};

const recordValue = (value: JsonRecord, key: string): JsonRecord | undefined => {
    const candidate = value[key];
    return isRecord(candidate) ? candidate : undefined;
};

const normalizeOptions = (value: unknown): ArtParamOption[] | undefined => {
    if (!Array.isArray(value)) return undefined;

    const options = value.flatMap<ArtParamOption>((candidate) => {
        if (["string", "number", "boolean"].includes(typeof candidate)) {
            const scalar = candidate as string | number | boolean;
            return [{ value: scalar, label: String(scalar) }];
        }
        if (!isRecord(candidate)) return [];

        const optionValue = candidate.value;
        if (!["string", "number", "boolean"].includes(typeof optionValue)) return [];
        const scalar = optionValue as string | number | boolean;
        return [{
            value: scalar,
            label: stringValue(candidate, "label") ?? String(scalar),
        }];
    });

    return options.length > 0 ? options : undefined;
};

const inferWidget = (raw: JsonRecord, dataType: string | undefined, options: ArtParamOption[] | undefined) => {
    const explicit = stringValue(raw, "widget");
    if (explicit) return explicit.toLowerCase();
    if (options?.length) return "select";

    const normalizedType = (dataType ?? "").toLowerCase();
    if (["boolean", "bool"].includes(normalizedType)) return "checkbox";
    if (["number", "integer", "int", "float", "double"].includes(normalizedType)) return "number";
    if (["enum", "select"].includes(normalizedType)) return "select";
    if (["json", "object", "array"].includes(normalizedType)) return "textarea";
    if (["path", "directory", "folder"].includes(normalizedType)) return "path";
    if (normalizedType.includes("image")) return "image_link";
    return "text";
};

const normalizeParam = (
    value: unknown,
    defaults: JsonRecord,
): ArtParam | undefined => {
    if (!isRecord(value)) return undefined;
    const id = stringValue(value, "id");
    if (!id) return undefined;

    const dataType = stringValue(value, "data_type");
    const options = normalizeOptions(value.options);
    const widget = inferWidget(value, dataType, options);
    const defaultValue = hasOwn(value, "default")
        ? value.default
        : hasOwn(defaults, id)
            ? defaults[id]
            : undefined;

    return {
        id,
        label: stringValue(value, "label") ?? id,
        widget,
        default: defaultValue,
        min: optionalFiniteNumber(value, "min"),
        max: optionalFiniteNumber(value, "max"),
        step: optionalFiniteNumber(value, "step"),
        options,
        multiline: optionalBoolean(value, "multiline") ?? widget === "textarea",
        group: stringValue(value, "group"),
        data_type: dataType,
        required: optionalBoolean(value, "required"),
        secret: optionalBoolean(value, "secret"),
        disabled: optionalBoolean(value, "disabled"),
    };
};

const normalizePort = (value: unknown): ArtPortDefinition | undefined => {
    if (!isRecord(value)) return undefined;
    const name = stringValue(value, "name");
    if (!name) return undefined;

    const dataType = stringValue(value, "data_type");
    const executionType = stringValue(value, "execution_type");
    return {
        name,
        label: stringValue(value, "label") ?? name,
        type: stringValue(value, "type") ?? dataType ?? executionType ?? "any",
        default: value.default,
        defaultVisible: optionalBoolean(value, "defaultVisible"),
        exposePort: optionalBoolean(value, "exposePort"),
        execution_type: executionType,
        data_type: dataType,
        widget: stringValue(value, "widget"),
        required: optionalBoolean(value, "required"),
    };
};

const normalizePorts = (value: unknown): ArtPortDefinition[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const ports = value.flatMap<ArtPortDefinition>((port) => {
        const normalized = normalizePort(port);
        return normalized ? [normalized] : [];
    });
    return ports;
};

const normalizeTransports = (value: unknown): TransportMode[] => {
    if (!Array.isArray(value)) return [...DEFAULT_TRANSPORTS];
    const transports = value.filter(
        (candidate): candidate is TransportMode =>
            typeof candidate === "string" && TRANSPORT_MODES.has(candidate as TransportMode),
    );
    return transports.length > 0 ? transports : [...DEFAULT_TRANSPORTS];
};

const normalizeBooleanMap = (value: unknown): Record<string, boolean> | undefined => {
    if (!isRecord(value)) return undefined;
    const entries = Object.entries(value).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
    );
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const normalizeCapability = (value: unknown): ArtCapability | undefined => {
    if (!isRecord(value) || value.enabled === false) return undefined;

    const metadata = isRecord(value.metadata) ? value.metadata : undefined;
    const id = stringValue(value, "id");
    if (!id) return undefined;

    const defaults = recordValue(value, "defaults") ?? {};
    const params = Array.isArray(value.parameters)
        ? value.parameters.flatMap<ArtParam>((param) => {
            const normalized = normalizeParam(param, defaults);
            return normalized ? [normalized] : [];
        })
        : [];
    const execution = isRecord(value.execution) ? value.execution : undefined;
    const executionType = execution ? stringValue(execution, "type") : undefined;

    return {
        id,
        label: stringValue(value, "label") ?? id,
        description: stringValue(value, "description") ?? "",
        supported_transports: normalizeTransports(value.supportedTransports),
        params,
        enabled: value.enabled !== false,
        auto_process: optionalBoolean(value, "autoProcess"),
        execution,
        defaults,
        metadata: metadata as ArtCapability["metadata"],
        defaultVisibility: normalizeBooleanMap(value.defaultVisibility),
        inputs: normalizePorts(value.inputs),
        outputs: normalizePorts(value.outputs),
    };
};

export const normalizeArtCapabilities = (values: readonly unknown[]): ArtCapability[] => {
    const normalized: ArtCapability[] = [];
    const seen = new Set<string>();

    for (const value of values) {
        const capability = normalizeCapability(value);
        if (!capability || seen.has(capability.id)) continue;
        seen.add(capability.id);
        normalized.push(capability);
    }

    return normalized;
};
