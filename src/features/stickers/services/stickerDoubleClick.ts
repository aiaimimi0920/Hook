type ClosestCapableTarget = EventTarget & {
    closest?: (selector: string) => unknown;
};

type ContainingTarget = EventTarget & {
    contains?: (node: Node | null) => boolean;
};

export const isStickerSurfaceDoubleClickTarget = (
    eventTarget: EventTarget | null,
    unitContainer: EventTarget | null,
): boolean => !!resolveStickerSurfaceDoubleClickTarget(eventTarget, unitContainer);

export const resolveStickerSurfaceDoubleClickTarget = (
    eventTarget: EventTarget | null,
    unitContainer: EventTarget | null,
): HTMLElement | null => {
    if (!eventTarget || !unitContainer) return null;

    const closest = (eventTarget as ClosestCapableTarget).closest;
    if (typeof closest !== "function") return null;
    const contains = (unitContainer as ContainingTarget).contains;
    if (typeof contains !== "function") return null;

    const stickerVisual = closest.call(eventTarget, ".sticker-visual");
    return stickerVisual && contains.call(unitContainer, stickerVisual as Node)
        ? (stickerVisual as HTMLElement)
        : null;
};
