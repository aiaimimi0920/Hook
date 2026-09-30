import type { Unit } from "../types/unit";
import type { ProjectionFrame } from "./qrProjectionSnapshot";

/** Shares rasterization across target jobs; at most four full PNG frames stay resident. */
export function createProjectionFrameCache(render: (unit: Unit) => Promise<ProjectionFrame>) {
    const frames = new Map<string, { signature: string; promise: Promise<ProjectionFrame> }>();
    return {
        get(unit: Unit, signature: string) {
            const saved = frames.get(unit.id);
            if (saved?.signature === signature) return saved.promise;
            const entry = { signature, promise: render(unit) };
            frames.delete(unit.id);
            frames.set(unit.id, entry);
            while (frames.size > 4) frames.delete(frames.keys().next().value!);
            void entry.promise.catch(() => { if (frames.get(unit.id) === entry) frames.delete(unit.id); });
            return entry.promise;
        },
        remove(unitId: string) { frames.delete(unitId); },
        clear() { frames.clear(); },
    };
}
