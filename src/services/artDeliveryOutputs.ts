// Pure output-port mapping for art node deliveries.
//
// Extracted from app.tsx's handleArtDelivery so the branchy, defensive parts —
// scalar value extraction (`value ?? data` plus explicit outputs) and the
// output-map merge (previewSrc drives both `output` and `output_image`,
// filePath drives `file_path`) — can be characterized by tests. The async /
// IPC / store-writing orchestration (shared-memory reads, error/shader early
// returns, updateUnitData, sync) stays in app.tsx and calls these helpers.

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
