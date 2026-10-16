export interface StickerEditSyncSchedulerOptions {
    debounceMs: number;
    propagateResize: (unitId: string) => void;
    performSync: () => void | Promise<void>;
}

export const createStickerEditSyncScheduler = ({
    debounceMs,
    propagateResize,
    performSync,
}: StickerEditSyncSchedulerOptions) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const pendingResizeUnitIds = new Set<string>();
    let disposed = false;

    const schedule = () => {
        if (disposed) return;
        if (timer !== null) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
            timer = null;
            const resizeUnitIds = [...pendingResizeUnitIds];
            pendingResizeUnitIds.clear();
            for (const resizeUnitId of resizeUnitIds) {
                propagateResize(resizeUnitId);
            }
            void performSync();
        }, debounceMs);
    };

    return {
        scheduleAppearance() {
            schedule();
        },
        scheduleResize(unitId: string) {
            pendingResizeUnitIds.add(unitId);
            schedule();
        },
        dispose() {
            disposed = true;
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
            pendingResizeUnitIds.clear();
        },
    };
};
