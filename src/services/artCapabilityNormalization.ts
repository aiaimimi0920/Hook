import type {
    ArtCapability,
    ArtCapabilityMetadata,
    ArtExecutionType,
    ArtParam,
    ArtParamOption,
    ArtPortDefinition,
    TransportMode,
} from "./protocol";

type JsonRecord = Record<string, unknown>;

const DEFAULT_TRANSPORTS: TransportMode[] = ["shared_memory"];
const TRANSPORT_MODES = new Set<TransportMode>([
    "shared_memory",
    "socket",
    "cloudflare_relay",
]);

const isRecord = (value: unknown): value is JsonRecord =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const hasOwn = (value: JsonRecord, key: string) =>
    Object.prototype.hasOwnProperty.call(value, key);

const firstValue = (value: JsonRecord, keys: readonly string[]): unknown => {
    for (const key of keys) {
        if (hasOwn(value, key)) return value[key];
    }
    return undefined;
};

const firstString = (value: JsonRecord, keys: readonly string[]): string | undefined => {
    for (const key of keys) {
        const candidate = value[key];
        if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
    return undefined;
};

const optionalBoolean = (value: JsonRecord, keys: readonly string[]): boolean | undefined => {
    const candidate = firstValue(value, keys);
    return typeof candidate === "boolean" ? candidate : undefined;
};

const optionalFiniteNumber = (value: JsonRecord, keys: readonly string[]): number | undefined => {
    const candidate = firstValue(value, keys);
    return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
};

const recordValue = (value: JsonRecord, keys: readonly string[]): JsonRecord | undefined => {
    const candidate = firstValue(value, keys);
    return isRecord(candidate) ? candidate : undefined;
};

const nestedString = (value: JsonRecord | undefined, path: readonly string[]): string | undefined => {
    let current: unknown = value;
    for (const segment of path) {
        if (!isRecord(current)) return undefined;
        current = current[segment];
    }
    return typeof current === "string" && current.trim() ? current.trim() : undefined;
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
            label: firstString(candidate, ["label", "name"]) ?? String(scalar),
        }];
    });

    return options.length > 0 ? options : undefined;
};

const inferWidget = (raw: JsonRecord, dataType: string | undefined, options: ArtParamOption[] | undefined) => {
    const explicit = firstString(raw, ["widget", "control"]);
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
    const id = firstString(value, ["id", "name"]);
    if (!id) return undefined;

    const dataType = firstString(value, ["data_type", "dataType", "parameter_type", "parameterType", "type"]);
    const options = normalizeOptions(value.options);
    const widget = inferWidget(value, dataType, options);
    const defaultValue = hasOwn(value, "default")
        ? value.default
        : hasOwn(defaults, id)
            ? defaults[id]
            : undefined;

    return {
        id,
        label: firstString(value, ["label", "name"]) ?? id,
        widget,
        default: defaultValue,
        min: optionalFiniteNumber(value, ["min", "minimum"]),
        max: optionalFiniteNumber(value, ["max", "maximum"]),
        step: optionalFiniteNumber(value, ["step"]),
        options,
        multiline: optionalBoolean(value, ["multiline"]) ?? widget === "textarea",
        group: firstString(value, ["group"]),
        data_type: dataType,
        required: optionalBoolean(value, ["required"]),
        secret: optionalBoolean(value, ["secret"]),
        disabled: optionalBoolean(value, ["disabled"]),
    };
};

const normalizePort = (value: unknown): ArtPortDefinition | undefined => {
    if (!isRecord(value)) return undefined;
    const name = firstString(value, ["name", "id"]);
    if (!name) return undefined;

    const dataType = firstString(value, ["data_type", "dataType"]);
    const executionType = firstString(value, ["execution_type", "executionType"]);
    return {
        name,
        label: firstString(value, ["label", "name"]) ?? name,
        type: firstString(value, ["type"]) ?? dataType ?? executionType ?? "any",
        default: firstValue(value, ["default"]),
        defaultVisible: optionalBoolean(value, ["defaultVisible", "default_visible"]),
        exposePort: optionalBoolean(value, ["exposePort", "expose_port"]),
        execution_type: executionType,
        data_type: dataType,
        widget: firstString(value, ["widget"]),
        required: optionalBoolean(value, ["required"]),
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
    const legacyId = firstString(value, ["id", "art_id", "artId"]);
    const publisherId = nestedString(metadata, ["packageSecurity", "publisher", "id"]);
    const qualifiedId =
        firstString(value, ["qualifiedId", "qualified_id"]) ??
        nestedString(metadata, ["art", "qualifiedId"]) ??
        nestedString(metadata, ["art", "qualified_id"]) ??
        nestedString(metadata, ["artPackage", "qualifiedId"]) ??
        nestedString(metadata, ["artPackage", "qualified_id"]) ??
        (publisherId && legacyId ? `${publisherId}/${legacyId}` : undefined);
    const id = qualifiedId ?? legacyId;
    if (!id) return undefined;

    const defaults = recordValue(value, ["defaults"]) ?? {};
    const params = Array.isArray(value.params)
        ? value.params.flatMap<ArtParam>((param) => {
            const normalized = normalizeParam(param, defaults);
            return normalized ? [normalized] : [];
        })
        : [];
    const execution = isRecord(value.execution) ? value.execution : undefined;
    const executionType =
        firstString(value, ["execution_type", "executionType"]) ??
        (execution ? firstString(execution, ["type"]) : undefined);
    const capabilities = recordValue(value, ["capabilities"]) as ArtCapabilityMetadata | undefined;

    return {
        id,
        legacyId: legacyId && legacyId !== id ? legacyId : undefined,
        qualifiedId,
        label: firstString(value, ["label", "name"]) ?? id,
        description: firstString(value, ["description"]) ?? "",
        supported_transports: normalizeTransports(
            firstValue(value, ["supported_transports", "supportedTransports"]),
        ),
        params,
        enabled: value.enabled !== false,
        auto_process: optionalBoolean(value, ["auto_process", "autoProcess"]),
        execution_type: executionType as ArtExecutionType | undefined,
        execution,
        defaults,
        capabilities,
        metadata: metadata as ArtCapability["metadata"],
        defaultVisibility: normalizeBooleanMap(
            firstValue(value, ["defaultVisibility", "default_visibility"]),
        ),
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
