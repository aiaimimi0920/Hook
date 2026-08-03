const unitPrefetchGeneration = new Map<string, number>();

export const nextImageSearchPrefetchGeneration = (unitId: string) => {
    const nextGeneration = (unitPrefetchGeneration.get(unitId) || 0) + 1;
    unitPrefetchGeneration.set(unitId, nextGeneration);
    return nextGeneration;
};

export const isImageSearchPrefetchGenerationCurrent = (
    unitId: string,
    generation: number,
) => unitPrefetchGeneration.get(unitId) === generation;

export const releaseImageSearchPrefetchGeneration = (
    unitId: string,
    generation: number,
) => {
    if (unitPrefetchGeneration.get(unitId) === generation) {
        unitPrefetchGeneration.delete(unitId);
    }
};

export const clearImageSearchPrefetchGenerationForUnit = (unitId: string) => {
    unitPrefetchGeneration.delete(unitId);
};

export const clearAllImageSearchPrefetchGenerations = () => {
    unitPrefetchGeneration.clear();
};

export const getImageSearchPrefetchGenerationCount = () => unitPrefetchGeneration.size;
