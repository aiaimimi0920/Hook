export interface CaptureInputCleanupDependencies {
    reason: string;
    setCaptureInputInactive: () => Promise<void>;
    clearHover: () => void;
    resetSelection: () => void;
    setOverlayClickThrough: () => Promise<void>;
    restoreMouseMonitor: boolean;
    setMouseMonitorActive: () => Promise<void>;
    updateBackendRects: () => Promise<void>;
}

type CleanupStep = {
    name: string;
    run: () => void | Promise<void>;
};

/** Runs every release boundary even when an earlier native call rejects. */
export async function cleanupCaptureInput({
    reason,
    setCaptureInputInactive,
    clearHover,
    resetSelection,
    setOverlayClickThrough,
    restoreMouseMonitor,
    setMouseMonitorActive,
    updateBackendRects,
}: CaptureInputCleanupDependencies): Promise<string[]> {
    const steps: CleanupStep[] = [
        { name: "native-input", run: setCaptureInputInactive },
        { name: "hover", run: clearHover },
        { name: "selection", run: resetSelection },
        { name: "click-through", run: setOverlayClickThrough },
    ];
    if (restoreMouseMonitor) {
        steps.push(
            { name: "mouse-monitor", run: setMouseMonitorActive },
            { name: "backend-rects", run: updateBackendRects },
        );
    }

    const failures: string[] = [];
    for (const step of steps) {
        try {
            await step.run();
        } catch {
            failures.push(step.name);
        }
    }
    if (failures.length > 0) {
        // Do not copy native error details into logs; step names are enough to
        // diagnose a partial cleanup without exposing paths or payload data.
        console.error(`[Hook] capture cleanup incomplete (${reason}: ${failures.join(",")})`);
    }
    return failures;
}
