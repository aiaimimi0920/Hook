/** Resources prepare in the background; an entire revision becomes visible at one local paint. */
import type { TileClock } from './tileClock';
import type { WallScene, WallSceneReport } from './wallTypes';

export function createTileSceneGate(clock: TileClock | undefined, visible: (value: boolean) => void) {
    let key = '', scene: WallScene | undefined, prepared = false, appliedAtMs: number | null = null;
    function begin(nextKey: string, nextScene?: WallScene): boolean {
        scene = nextScene;
        if (key === nextKey) return false;
        key = nextKey; prepared = false; appliedAtMs = null; visible(false);
        return true;
    }
    function permit(ready: boolean): boolean {
        prepared = ready;
        const estimate = clock?.estimate();
        const permitted = ready && (!scene || Boolean(estimate
            && estimate.serverTimeMs - estimate.uncertaintyMs >= scene.activateAtMs));
        if (!permitted) { appliedAtMs = null; visible(false); }
        return permitted;
    }
    function applied() {
        const estimate = clock?.estimate();
        if (scene && (!estimate || estimate.serverTimeMs - estimate.uncertaintyMs < scene.activateAtMs)) {
            appliedAtMs = null; visible(false); return false;
        }
        if (scene && appliedAtMs === null && estimate) appliedAtMs = Math.round(estimate.serverTimeMs);
        visible(true);
        return true;
    }
    function report(): WallSceneReport | undefined {
        return scene ? { revision: scene.revision, prepared, appliedAtMs,
            clockUncertaintyMs: clock?.estimate()?.uncertaintyMs ?? null } : undefined;
    }
    function clear() { key = ''; scene = undefined; prepared = false; appliedAtMs = null; visible(false); }
    return { begin, permit, applied, report, clear };
}
