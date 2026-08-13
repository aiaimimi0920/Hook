export interface ActiveArtExecutionRequest {
    requestId: string;
    generation: number;
}

export interface ArtExecutionRequestRegistry {
    begin(unitId: string): string;
    active(unitId: string): ActiveArtExecutionRequest | undefined;
    generation(unitId: string, requestId: string): number | undefined;
    isLatest(unitId: string, requestId: string): boolean;
    markPreview(unitId: string, requestId: string, previewSrc: string): void;
    getPreview(unitId: string, requestId: string): string | undefined;
    finish(unitId: string, requestId: string): void;
    invalidate(unitId: string): void;
}

const defaultRequestIdFactory = (): string => {
    if (typeof globalThis.crypto?.randomUUID === "function") {
        return globalThis.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const createArtExecutionRequestRegistry = (
    requestIdFactory: () => string = defaultRequestIdFactory,
): ArtExecutionRequestRegistry => {
    const latestByUnit = new Map<string, string>();
    const generationByUnit = new Map<string, number>();
    const previewByUnit = new Map<string, { requestId: string; previewSrc: string }>();

    return {
        begin(unitId) {
            const requestId = requestIdFactory();
            generationByUnit.set(unitId, (generationByUnit.get(unitId) ?? 0) + 1);
            latestByUnit.set(unitId, requestId);
            previewByUnit.delete(unitId);
            return requestId;
        },
        active(unitId) {
            const requestId = latestByUnit.get(unitId);
            const generation = generationByUnit.get(unitId);
            if (!requestId || generation === undefined) {
                return undefined;
            }
            return { requestId, generation };
        },
        generation(unitId, requestId) {
            return latestByUnit.get(unitId) === requestId
                ? generationByUnit.get(unitId)
                : undefined;
        },
        isLatest(unitId, requestId) {
            return latestByUnit.get(unitId) === requestId;
        },
        markPreview(unitId, requestId, previewSrc) {
            const latest = latestByUnit.get(unitId);
            if (requestId && latest === requestId) {
                previewByUnit.set(unitId, { requestId, previewSrc });
            }
        },
        getPreview(unitId, requestId) {
            const preview = previewByUnit.get(unitId);
            return requestId && preview?.requestId === requestId
                ? preview.previewSrc
                : undefined;
        },
        finish(unitId, requestId) {
            if (latestByUnit.get(unitId) === requestId) {
                latestByUnit.delete(unitId);
                previewByUnit.delete(unitId);
            }
        },
        invalidate(unitId) {
            latestByUnit.delete(unitId);
            previewByUnit.delete(unitId);
        },
    };
};

export const artExecutionRequests = createArtExecutionRequestRegistry();
