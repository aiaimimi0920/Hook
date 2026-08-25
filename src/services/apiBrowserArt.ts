// Translates browser Art actions and validates formal Loom results before terminal delivery.
import type {
    ArtDelivery,
    ArtResultCandidateMetadata,
    DeliveryPayload,
    HookArtPortValue,
    HookArtResultCommit,
    HookResponse,
} from "./protocol";
import { browserLoomHookRequest } from "./apiBrowserLoomTransport";
import { warnBrowserFallback } from "./apiTransport";

const BROWSER_ART_EXECUTE_TIMEOUT_MS = 150000;
const PREFERRED_HOOK_ART_OUTPUT_NAMES = ["output_image", "output", "image"] as const;

const browserInlineResource = (source: string): HookArtPortValue => {
    const match = /^data:([^;,]+);base64,(.+)$/s.exec(source);
    if (!match) {
        throw new Error("Browser Art execution requires data URL image inputs");
    }
    return {
        kind: "inline_resource",
        mime: match[1],
        dataBase64: match[2],
    };
};

const preferredHookArtOutput = (
    outputs: Record<string, HookArtPortValue>,
): [string, HookArtPortValue] | undefined => {
    for (const name of PREFERRED_HOOK_ART_OUTPUT_NAMES) {
        const value = outputs[name];
        if (value) {
            return [name, value];
        }
    }
    return Object.entries(outputs)[0];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);

const requireNonEmptyString = (value: unknown, field: string): string => {
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`Loom Hook formal value is missing ${field}`);
    }
    return value;
};

const requirePositiveInteger = (value: unknown, field: string): number => {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`Loom Hook formal value has invalid ${field}`);
    }
    return value;
};

const validateBareBase64 = (value: string): void => {
    if (value.startsWith("data:") || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
        throw new Error("Loom Hook inline formal value has invalid bare dataBase64");
    }
};

const validateBrowserPortValue = (value: unknown): HookArtPortValue => {
    if (!isRecord(value)) {
        throw new Error("Loom Hook formal output must be an object");
    }
    switch (value.kind) {
        case "value":
            if (!("value" in value)) {
                throw new Error("Loom Hook value formal output is missing value");
            }
            return { kind: "value", value: value.value };
        case "inline_resource": {
            const mime = requireNonEmptyString(value.mime, "mime");
            const dataBase64 = requireNonEmptyString(value.dataBase64, "dataBase64");
            validateBareBase64(dataBase64);
            const width = value.width === undefined
                ? undefined
                : requirePositiveInteger(value.width, "width");
            const height = value.height === undefined
                ? undefined
                : requirePositiveInteger(value.height, "height");
            return { kind: "inline_resource", mime, dataBase64, width, height };
        }
        case "shared_memory": {
            if (value.format !== "rgba8") {
                throw new Error("Loom Hook shared-memory formal output must use rgba8");
            }
            const handle = requireNonEmptyString(value.handle, "handle");
            if (!handle.startsWith("Loom_Buffer_")) {
                throw new Error("Loom Hook shared-memory formal output has an invalid handle");
            }
            return {
                kind: "shared_memory",
                handle,
                size: requirePositiveInteger(value.size, "size"),
                width: requirePositiveInteger(value.width, "width"),
                height: requirePositiveInteger(value.height, "height"),
                format: "rgba8",
            };
        }
        case "resource":
            if (!isRecord(value.resource)) {
                throw new Error("Loom Hook broker resource formal output is missing resource");
            }
            return { kind: "resource", resource: value.resource };
        default:
            throw new Error("Loom Hook formal output has an unsupported kind");
    }
};

const browserPortValueToOutput = (untrustedValue: unknown): unknown => {
    const value = validateBrowserPortValue(untrustedValue);
    switch (value.kind) {
        case "inline_resource":
            return `data:${value.mime};base64,${value.dataBase64}`;
        case "value":
            return value.value;
        case "shared_memory":
            throw new Error("Browser Art execution cannot read Loom shared-memory outputs");
        case "resource":
            throw new Error("Browser Art execution cannot read broker resource outputs");
    }
};

const browserPortValueDelivery = (untrustedValue: unknown): DeliveryPayload => {
    const value = validateBrowserPortValue(untrustedValue);
    switch (value.kind) {
        case "inline_resource":
            return {
                type: "base64",
                data: `data:${value.mime};base64,${value.dataBase64}`,
                width: value.width,
                height: value.height,
            };
        case "shared_memory":
            throw new Error("Browser Art execution cannot read Loom shared-memory outputs");
        case "value": {
            const record = value.value && typeof value.value === "object"
                ? value.value as Record<string, unknown>
                : undefined;
            const candidates = record?.loomMetadata && typeof record.loomMetadata === "object"
                ? (record.loomMetadata as Record<string, unknown>).candidates
                : undefined;
            return {
                type: "value",
                value: value.value,
                ...(candidates && typeof candidates === "object"
                    ? { candidates: candidates as ArtResultCandidateMetadata }
                    : {}),
            };
        }
        case "resource":
            throw new Error("Browser Art execution cannot read broker resource outputs");
    }
};

export const browserDispatchActionFallback = async (
    actionEnum: { action: string; payload: unknown },
): Promise<void> => {
    const payload = actionEnum.payload && typeof actionEnum.payload === "object"
        ? actionEnum.payload as Record<string, unknown>
        : {};
    try {
        switch (actionEnum.action) {
            case "sync_workflow":
                await browserLoomHookRequest({
                    method: "loom.hook.workflow.sync",
                    params: {
                        requestId: `workflow-sync:${crypto.randomUUID()}`,
                        workflowId: payload.workflow_id,
                        snapshot: payload.snapshot,
                    },
                });
                return;
            case "update_workflow_node":
                await browserLoomHookRequest({
                    method: "loom.hook.workflow.node.update",
                    params: {
                        requestId: payload.request_id,
                        workflowId: payload.workflow_id,
                        nodeId: payload.node_id,
                        parameterId: payload.parameter_id,
                        value: payload.value,
                    },
                });
                return;
            case "cancel_art": {
                const response = await browserLoomHookRequest<HookResponse>({
                    method: "loom.hook.art.cancel",
                    params: {
                        protocolVersion: "loom.hook.v1",
                        requestId: payload.request_id,
                        nodeId: payload.node_id,
                        generation: payload.generation,
                        deviceId: "device:browser-preview",
                    },
                }, { timeoutMs: 5_000 });
                if (
                    response.status === "failed"
                    && response.error?.code !== "request_not_found"
                ) {
                    throw new Error(response.error?.message ?? `Art cancel ${response.status}`);
                }
                return;
            }
            case "execute_art": {
                const response = await browserLoomHookRequest<HookResponse<HookArtResultCommit>>({
                    method: "loom.hook.art.execute",
                    params: {
                        protocolVersion: "loom.hook.v1",
                        requestId: payload.request_id,
                        nodeId: payload.node_id,
                        artId: payload.art_id,
                        generation: payload.generation,
                        deviceId: "device:browser-preview",
                        outputTransports: ["websocket"],
                        inputs: Object.fromEntries(
                            Object.entries((payload.inputs as Record<string, string> | undefined) ?? {})
                                .map(([name, value]): [string, HookArtPortValue] => [
                                    name,
                                    browserInlineResource(value),
                                ]),
                        ),
                        parameters: payload.parameters ?? {},
                        disabledParameters: payload.disabled_parameters ?? [],
                    },
                }, { timeoutMs: BROWSER_ART_EXECUTE_TIMEOUT_MS });
                if (response.status !== "succeeded") {
                    throw new Error(response.error?.message ?? `Art execution ${response.status}`);
                }
                if (
                    response.data.protocolVersion !== "loom.hook.v1"
                    || response.data.requestId !== payload.request_id
                    || response.data.nodeId !== payload.node_id
                    || response.data.generation !== payload.generation
                    || !Number.isSafeInteger(response.data.resultRevision)
                    || response.data.resultRevision < 1
                    || !isRecord(response.data.outputs)
                ) {
                    throw new Error("Loom Hook Art execution returned an invalid result commit");
                }
                const outputs = response.data.outputs;
                const primary = preferredHookArtOutput(outputs);
                if (!primary) {
                    throw new Error("Loom Hook Art execution returned no output");
                }
                const decodedOutputs = Object.fromEntries(
                    Object.entries(outputs).map(([name, portValue]) => [
                        name,
                        browserPortValueToOutput(portValue),
                    ]),
                );
                if (typeof payload.node_id !== "string" || typeof payload.request_id !== "string") {
                    throw new Error("Browser Art execution requires string node_id and request_id");
                }
                window.dispatchEvent(new CustomEvent("hook-browser-art-ready", {
                    detail: {
                        art_id: payload.node_id,
                        request_id: payload.request_id,
                        generation: response.data.generation,
                        result_revision: response.data.resultRevision,
                        phase: "final",
                        status: 200,
                        delivery: {
                            ...browserPortValueDelivery(primary[1]),
                            outputs: decodedOutputs,
                            ...(response.data.candidates
                                ? { candidates: response.data.candidates }
                                : {}),
                        },
                    } satisfies ArtDelivery,
                }));
                return;
            }
            default:
                warnBrowserFallback(`dispatch:${actionEnum.action}`);
                return;
        }
    } catch (error) {
        if (actionEnum.action === "execute_art") {
            const nodeId = payload.node_id;
            const requestId = payload.request_id;
            const message = error instanceof Error ? error.message : String(error);
            if (typeof nodeId === "string" && typeof requestId === "string") {
                window.dispatchEvent(new CustomEvent("hook-browser-art-ready", {
                    detail: {
                        art_id: nodeId,
                        request_id: requestId,
                        status: 500,
                        error: message,
                        delivery: { type: "base64" },
                    } satisfies ArtDelivery,
                }));
            }
            return;
        }
        // Keep external action names and error text out of the console sink.
        // Browser payloads are untrusted and may contain control characters.
        console.warn("[API] browser dispatch fallback failed");
    }
};
