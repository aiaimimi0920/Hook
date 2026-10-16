export const STICKER_GPU_WARM_MAX_ENTRIES = 5;
export const STICKER_GPU_WARM_PIXEL_BUDGET_BYTES = 64 * 1024 * 1024;
export const STICKER_GPU_WARM_RECENT_TTL_MS = 10_000;
export const STICKER_GPU_WARM_HOVER_DELAY_MS = 50;
export const STICKER_GPU_WARM_HOVER_GRACE_MS = 750;

type TimerHandle = ReturnType<typeof setTimeout>;

type StickerGpuWarmEntry = {
    unitId: string;
    element: HTMLElement;
    originalWillChange: string;
    appliedWillChange: string;
    estimatedBytes: number;
    warm: boolean;
    selected: boolean;
    hovered: boolean;
    hoverReady: boolean;
    dragging: boolean;
    hoverGraceUntil: number;
    recentUntil: number;
    lastTouchedOrder: number;
    hoverTimer: TimerHandle | null;
    expiryTimer: TimerHandle | null;
};

export type StickerGpuWarmPoolSnapshot = {
    warmUnitIds: string[];
    totalEstimatedBytes: number;
    entries: Array<{
        unitId: string;
        estimatedBytes: number;
        warm: boolean;
        selected: boolean;
        hovered: boolean;
        dragging: boolean;
    }>;
};

const entries = new Map<string, StickerGpuWarmEntry>();
let touchOrder = 0;

const currentTime = () => Date.now();

const clearTimer = (timer: TimerHandle | null) => {
    if (timer !== null) {
        clearTimeout(timer);
    }
};

const mergeTransformWillChange = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "auto") return "transform";
    const properties = trimmed.split(",").map((property) => property.trim());
    if (properties.includes("transform")) return trimmed;
    return `${trimmed}, transform`;
};

const estimatePixelBytes = (width: number, height: number, devicePixelRatio: number) => {
    const safeWidth = Math.max(1, Math.ceil(Number.isFinite(width) ? width : 1));
    const safeHeight = Math.max(1, Math.ceil(Number.isFinite(height) ? height : 1));
    const safeDpr = Math.max(1, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1);
    return Math.ceil(safeWidth * safeHeight * safeDpr * safeDpr * 4);
};

const touchEntry = (entry: StickerGpuWarmEntry) => {
    touchOrder += 1;
    entry.lastTouchedOrder = touchOrder;
};

const restoreEntryStyle = (entry: StickerGpuWarmEntry) => {
    entry.element.style.willChange = entry.originalWillChange;
    entry.warm = false;
};

const coolEntry = (entry: StickerGpuWarmEntry) => {
    clearTimer(entry.expiryTimer);
    entry.expiryTimer = null;
    if (entry.warm) {
        restoreEntryStyle(entry);
    }
};

const warmEntry = (entry: StickerGpuWarmEntry) => {
    if (!entry.warm) {
        entry.appliedWillChange = mergeTransformWillChange(entry.originalWillChange);
        entry.element.style.willChange = entry.appliedWillChange;
        entry.warm = true;
    } else if (entry.element.style.willChange !== entry.appliedWillChange) {
        entry.element.style.willChange = entry.appliedWillChange;
    }
};

const entryPriority = (entry: StickerGpuWarmEntry, now: number) => {
    if (entry.dragging) return 4;
    if (entry.hovered && entry.hoverReady) return 3;
    if (entry.selected) return 2;
    if (entry.recentUntil > now || entry.hoverGraceUntil > now) return 1;
    return 0;
};

const enforceWarmPoolLimits = () => {
    const now = currentTime();
    let warmEntries = Array.from(entries.values()).filter((entry) => entry.warm);
    let totalEstimatedBytes = warmEntries.reduce((total, entry) => total + entry.estimatedBytes, 0);

    while (
        warmEntries.length > STICKER_GPU_WARM_MAX_ENTRIES ||
        totalEstimatedBytes > STICKER_GPU_WARM_PIXEL_BUDGET_BYTES
    ) {
        const evictionCandidates = warmEntries
            .filter((entry) => !entry.dragging)
            .sort((left, right) => {
                const priorityDelta = entryPriority(left, now) - entryPriority(right, now);
                if (priorityDelta !== 0) return priorityDelta;
                return left.lastTouchedOrder - right.lastTouchedOrder;
            });
        const victim = evictionCandidates[0];
        if (!victim) break;

        coolEntry(victim);
        totalEstimatedBytes -= victim.estimatedBytes;
        warmEntries = warmEntries.filter((entry) => entry !== victim);
    }
};

const scheduleEntryExpiry = (entry: StickerGpuWarmEntry) => {
    clearTimer(entry.expiryTimer);
    entry.expiryTimer = null;
    if (entry.dragging || entry.selected || (entry.hovered && entry.hoverReady)) return;

    const expiresAt = Math.max(entry.recentUntil, entry.hoverGraceUntil);
    const delay = expiresAt - currentTime();
    if (delay <= 0) {
        coolEntry(entry);
        return;
    }

    entry.expiryTimer = setTimeout(() => {
        entry.expiryTimer = null;
        if (entry.dragging || entry.selected || (entry.hovered && entry.hoverReady)) return;
        if (Math.max(entry.recentUntil, entry.hoverGraceUntil) > currentTime()) {
            scheduleEntryExpiry(entry);
            return;
        }
        coolEntry(entry);
    }, delay);
};

const requestEntryWarm = (entry: StickerGpuWarmEntry) => {
    touchEntry(entry);
    warmEntry(entry);
    scheduleEntryExpiry(entry);
    enforceWarmPoolLimits();
};

export const registerStickerGpuWarmElement = (
    unitId: string,
    element: HTMLElement,
    width: number,
    height: number,
    devicePixelRatio: number,
) => {
    const previous = entries.get(unitId);
    if (previous?.element === element) {
        previous.estimatedBytes = estimatePixelBytes(width, height, devicePixelRatio);
        enforceWarmPoolLimits();
        return;
    }
    if (previous) {
        clearTimer(previous.hoverTimer);
        clearTimer(previous.expiryTimer);
        restoreEntryStyle(previous);
    }

    entries.set(unitId, {
        unitId,
        element,
        originalWillChange: element.style.willChange,
        appliedWillChange: element.style.willChange,
        estimatedBytes: estimatePixelBytes(width, height, devicePixelRatio),
        warm: false,
        selected: false,
        hovered: false,
        hoverReady: false,
        dragging: false,
        hoverGraceUntil: 0,
        recentUntil: 0,
        lastTouchedOrder: 0,
        hoverTimer: null,
        expiryTimer: null,
    });
};

export const updateStickerGpuWarmEstimate = (
    unitId: string,
    width: number,
    height: number,
    devicePixelRatio: number,
) => {
    const entry = entries.get(unitId);
    if (!entry) return;
    entry.estimatedBytes = estimatePixelBytes(width, height, devicePixelRatio);
    if (entry.warm) {
        enforceWarmPoolLimits();
    }
};

export const unregisterStickerGpuWarmElement = (unitId: string, element?: HTMLElement) => {
    const entry = entries.get(unitId);
    if (!entry || (element && entry.element !== element)) return;
    clearTimer(entry.hoverTimer);
    clearTimer(entry.expiryTimer);
    restoreEntryStyle(entry);
    entries.delete(unitId);
};

export const setStickerGpuWarmSelected = (unitId: string, selected: boolean) => {
    const entry = entries.get(unitId);
    if (!entry || entry.selected === selected) return;
    entry.selected = selected;
    if (selected) {
        requestEntryWarm(entry);
    } else {
        scheduleEntryExpiry(entry);
        enforceWarmPoolLimits();
    }
};

export const enterStickerGpuWarmHover = (unitId: string) => {
    const entry = entries.get(unitId);
    if (!entry) return;
    entry.hovered = true;
    entry.hoverGraceUntil = 0;
    clearTimer(entry.hoverTimer);
    entry.hoverTimer = null;

    if (entry.warm) {
        entry.hoverReady = true;
        requestEntryWarm(entry);
        return;
    }

    entry.hoverTimer = setTimeout(() => {
        entry.hoverTimer = null;
        if (!entry.hovered) return;
        entry.hoverReady = true;
        requestEntryWarm(entry);
    }, STICKER_GPU_WARM_HOVER_DELAY_MS);
};

export const leaveStickerGpuWarmHover = (unitId: string) => {
    const entry = entries.get(unitId);
    if (!entry) return;
    entry.hovered = false;
    clearTimer(entry.hoverTimer);
    entry.hoverTimer = null;
    if (entry.hoverReady && entry.warm) {
        entry.hoverGraceUntil = currentTime() + STICKER_GPU_WARM_HOVER_GRACE_MS;
    }
    entry.hoverReady = false;
    scheduleEntryExpiry(entry);
};

export const beginStickerGpuWarmDrag = (unitId: string) => {
    const entry = entries.get(unitId);
    if (!entry) return;
    entry.dragging = true;
    requestEntryWarm(entry);
};

export const endStickerGpuWarmDrag = (unitId: string) => {
    const entry = entries.get(unitId);
    if (!entry) return;
    entry.dragging = false;
    entry.recentUntil = currentTime() + STICKER_GPU_WARM_RECENT_TTL_MS;
    requestEntryWarm(entry);
};

export const isStickerGpuWarm = (unitId: string) => entries.get(unitId)?.warm ?? false;

export const getStickerGpuWarmPoolSnapshot = (): StickerGpuWarmPoolSnapshot => {
    const orderedEntries = Array.from(entries.values()).sort(
        (left, right) => left.lastTouchedOrder - right.lastTouchedOrder,
    );
    const warmEntries = orderedEntries.filter((entry) => entry.warm);
    return {
        warmUnitIds: warmEntries.map((entry) => entry.unitId),
        totalEstimatedBytes: warmEntries.reduce((total, entry) => total + entry.estimatedBytes, 0),
        entries: orderedEntries.map((entry) => ({
            unitId: entry.unitId,
            estimatedBytes: entry.estimatedBytes,
            warm: entry.warm,
            selected: entry.selected,
            hovered: entry.hovered,
            dragging: entry.dragging,
        })),
    };
};

export const clearStickerGpuWarmPool = () => {
    for (const entry of entries.values()) {
        clearTimer(entry.hoverTimer);
        clearTimer(entry.expiryTimer);
        restoreEntryStyle(entry);
    }
    entries.clear();
    touchOrder = 0;
};
