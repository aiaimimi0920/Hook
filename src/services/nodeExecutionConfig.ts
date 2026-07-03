import type { ArtCapability } from "./protocol";
import { DEFAULT_EXECUTION_CONFIG, type NodeExecutionConfig } from "../types/unit";

type PlainObject = Record<string, unknown>;

const isPlainObject = (value: unknown): value is PlainObject =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const readBoolean = (
    source: PlainObject | undefined,
    key: string,
    fallback: boolean,
): boolean => {
    const value = source?.[key];
    return typeof value === "boolean" ? value : fallback;
};

const hasMeaningfulExecutionConfig = (config: unknown): boolean => {
    if (!isPlainObject(config)) return false;
    return isPlainObject(config.triggerMode) || isPlainObject(config.propagation);
};

export const isHighCostMcpImageSearchCapability = (capability?: ArtCapability): boolean => {
    if (capability?.execution_type !== "mcp") return false;

    const execution = isPlainObject(capability.execution) ? capability.execution : {};
    const rawToolName = execution.tool_name ?? execution.toolName;
    const toolName = typeof rawToolName === "string" ? rawToolName.toLowerCase() : "";

    return toolName.includes("image") && toolName.includes("search");
};

const cloneExecutionConfig = (
    config: unknown,
    options: { defaultParamDriven: boolean },
): NodeExecutionConfig => {
    const source = isPlainObject(config) ? config : {};
    const triggerMode = isPlainObject(source.triggerMode) ? source.triggerMode : undefined;
    const propagation = isPlainObject(source.propagation) ? source.propagation : undefined;
    const expanded = source.__expanded;

    return {
        triggerMode: {
            upstreamDriven: readBoolean(
                triggerMode,
                "upstreamDriven",
                DEFAULT_EXECUTION_CONFIG.triggerMode.upstreamDriven,
            ),
            paramDriven: readBoolean(triggerMode, "paramDriven", options.defaultParamDriven),
        },
        propagation: {
            listenUpstream: readBoolean(
                propagation,
                "listenUpstream",
                DEFAULT_EXECUTION_CONFIG.propagation.listenUpstream,
            ),
            notifyDownstream: readBoolean(
                propagation,
                "notifyDownstream",
                DEFAULT_EXECUTION_CONFIG.propagation.notifyDownstream,
            ),
        },
        ...(typeof expanded === "boolean" ? { __expanded: expanded } : {}),
    };
};

export const deriveUnitExecutionConfig = (input: {
    capability?: ArtCapability;
    explicitConfig?: unknown;
}): NodeExecutionConfig => {
    const shouldUseManualParamDefault =
        !hasMeaningfulExecutionConfig(input.explicitConfig) &&
        isHighCostMcpImageSearchCapability(input.capability);

    return cloneExecutionConfig(input.explicitConfig, {
        defaultParamDriven: shouldUseManualParamDefault
            ? false
            : DEFAULT_EXECUTION_CONFIG.triggerMode.paramDriven,
    });
};
