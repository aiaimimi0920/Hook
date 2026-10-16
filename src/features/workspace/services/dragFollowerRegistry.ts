type DragFollowerElement = {
    unitId: string;
    element: HTMLElement;
};

const followersByUnitId = new Map<string, Set<HTMLElement>>();

export const registerDragFollowerElement = (unitId: string, element: HTMLElement) => {
    let elements = followersByUnitId.get(unitId);
    if (!elements) {
        elements = new Set<HTMLElement>();
        followersByUnitId.set(unitId, elements);
    }
    elements.add(element);
};

export const unregisterDragFollowerElement = (unitId: string, element: HTMLElement) => {
    const elements = followersByUnitId.get(unitId);
    if (!elements) return;

    elements.delete(element);
    if (elements.size === 0) {
        followersByUnitId.delete(unitId);
    }
};

export const getDragFollowerElements = (unitIds: Iterable<string>): DragFollowerElement[] => {
    const followers: DragFollowerElement[] = [];

    for (const unitId of unitIds) {
        const elements = followersByUnitId.get(unitId);
        if (!elements) continue;

        for (const element of elements) {
            if (!element.isConnected) {
                elements.delete(element);
                continue;
            }
            followers.push({ unitId, element });
        }

        if (elements.size === 0) {
            followersByUnitId.delete(unitId);
        }
    }

    return followers;
};

export const clearDragFollowerRegistry = () => {
    followersByUnitId.clear();
};
