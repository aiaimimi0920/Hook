// An old request must not mutate a replacement workspace, even when IDs are reused.
let generation = 0;
const unitRemovalListeners = new Set<(unitId: string) => void>();
export const projectionWorkspaceGeneration = () => generation;
export const invalidateProjectionWorkspace = () => { generation += 1; };

// Track active owners only; deleted IDs must not accumulate in a revision map.
export function onProjectionUnitRemoved(listener: (unitId: string) => void): () => void {
    unitRemovalListeners.add(listener);
    return () => { unitRemovalListeners.delete(listener); };
}

export function invalidateProjectionUnit(unitId: string): void {
    for (const listener of unitRemovalListeners) listener(unitId);
}
