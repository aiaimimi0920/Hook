import { graphStore } from "../store/graphStore";
import { enhancementNotices, uiActions } from "../store/uiStore";
import { prepareLiveCaptureUnitSnapshot } from "./liveCaptureUnit";

export type LiveSnapshotActionResult<T> = T | Promise<T | undefined>;

// Ordinary actions remain synchronous. Live consumers run only after all of
// their snapshots succeed; a failed readback must not delete or process old pixels.
export function runWithLiveCaptureSnapshots<T>(
    unitIds: readonly string[],
    action: () => T,
): LiveSnapshotActionResult<T> {
    const pending = [...new Set(unitIds)].flatMap((id) => {
        const snapshot = prepareLiveCaptureUnitSnapshot(id);
        return snapshot ? [snapshot] : [];
    });
    if (pending.length === 0) return action();
    return Promise.all(pending).then(() => {
        for (const id of unitIds) {
            for (const notice of enhancementNotices[id] ?? []) {
                if (notice.source?.id === "live-snapshot") uiActions.dismissEnhancementNotice(id, notice.id);
            }
        }
        return action();
    }, (error: unknown) => {
        console.warn("Live snapshot action failed", error instanceof Error ? error.name : "UnknownError");
        for (const id of unitIds) {
            if (!graphStore.units.some((unit) => unit.id === id)) continue;
            uiActions.showEnhancementNotice(id, {
                feature: "Interaction",
                source: { namespace: "core", id: "live-snapshot" },
                title: "Live snapshot unavailable",
                message: "Unable to capture the current Live frame. Please retry.",
            });
        }
        return undefined;
    });
}
