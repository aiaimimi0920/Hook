// Pure output-port mapping for art node deliveries.
//
// Extracted from app.tsx's handleArtDelivery so the branchy, defensive parts —
// scalar value extraction (`value ?? data` plus explicit outputs) and the
// output-map merge (previewSrc drives both `output` and `output_image`,
// filePath drives `file_path`) — can be characterized by tests. Shared-memory
// port materialization is also isolated here so primary and secondary image
// ports follow the same runtime validation. Store writes and workflow
// synchronization remain in app.tsx.

import type { DeliveryPayload } from "./protocol";

/**
 * Value-output map for scalar/text/json/number deliveries. `output` is the
 * delivered `value`, falling back to `data`, and any explicit `outputs` map is
 * spread on top (so an explicit `outputs.output` wins over the derived one).
 */
export const extractArtDeliveryValueOutputs = (
    delivery: Pick<DeliveryPayload, "value" | "data" | "outputs">,
): Record<string, unknown> => ({
    output: delivery.value ?? delivery.data,
    ...(delivery.outputs || {}),
});

export const materializeSharedMemoryOutputs = async (input: {
    outputs: Record<string, unknown>;
    primaryHandle?: string;
    primaryData?: string;
    readSharedMemory: (
        handle: string,
        size: number,
        width: number,
        height: number,
    ) => Promise<string>;
}): Promise<Record<string, unknown>> => {
    const outputs = { ...input.outputs };
    for (const [name, value] of Object.entries(outputs)) {
        if (
            !value ||
            typeof value !== "object" ||
            (value as { type?: unknown }).type !== "shared_memory"
        ) {
            continue;
        }
        const descriptor = value as {
            handle?: unknown;
            size?: unknown;
            width?: unknown;
            height?: unknown;
            format?: unknown;
        };
        if (
            descriptor.format !== "rgba8" ||
            typeof descriptor.handle !== "string" ||
            !descriptor.handle.startsWith("Loom_Buffer_") ||
            typeof descriptor.size !== "number" ||
            !Number.isSafeInteger(descriptor.size) ||
            descriptor.size <= 0 ||
            typeof descriptor.width !== "number" ||
            !Number.isSafeInteger(descriptor.width) ||
            descriptor.width <= 0 ||
            typeof descriptor.height !== "number" ||
            !Number.isSafeInteger(descriptor.height) ||
            descriptor.height <= 0
        ) {
            throw new Error(`Loom returned an invalid shared-memory output for port ${name}`);
        }
        outputs[name] =
            descriptor.handle === input.primaryHandle && input.primaryData !== undefined
                ? input.primaryData
                : await input.readSharedMemory(
                    descriptor.handle,
                    descriptor.size,
                    descriptor.width,
                    descriptor.height,
                );
    }
    return outputs;
};

/**
 * Merges a node's existing output-port map with newly delivered value outputs
 * and image/file results.
 *
 * Load-bearing ordering: existing outputs first, then value outputs (so fresh
 * values win), then image/file overrides last — a resolved `previewSrc` sets
 * both `output` and `output_image`, and `filePath` sets `file_path`, so an
 * image result takes precedence over a same-key scalar value.
 */
export const mergeArtDeliveryOutputs = (input: {
    currentOutputs?: Record<string, unknown>;
    valueOutputs?: Record<string, unknown>;
    previewSrc?: string;
    filePath?: string;
}): Record<string, unknown> => {
    const nextOutputs: Record<string, unknown> = {
        ...(input.currentOutputs || {}),
        ...(input.valueOutputs || {}),
    };
    if (input.previewSrc) {
        nextOutputs.output = input.previewSrc;
        nextOutputs.output_image = input.previewSrc;
    }
    if (input.filePath) {
        nextOutputs.file_path = input.filePath;
    }
    return nextOutputs;
};
