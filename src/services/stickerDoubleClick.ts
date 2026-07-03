type ClosestCapableTarget = EventTarget & {
    closest?: (selector: string) => unknown;
};

type ContainingTarget = EventTarget & {
    contains?: (node: Node | null) => boolean;
};

export const isStickerSurfaceDoubleClickTarget = (
    eventTarget: EventTarget | null,
    unitContainer: EventTarget | null,
): boolean => {
    if (!eventTarget || !unitContainer) return false;

    const closest = (eventTarget as ClosestCapableTarget).closest;
    if (typeof closest !== "function") return false;
    const contains = (unitContainer as ContainingTarget).contains;
    if (typeof contains !== "function") return false;

    const stickerVisual = closest.call(eventTarget, ".sticker-visual");
    return !!stickerVisual && contains.call(unitContainer, stickerVisual as Node);
};
