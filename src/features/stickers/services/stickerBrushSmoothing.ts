import type { StickerPoint } from "../types/stickerEditing";
import { freehandSmoothing, smoothFreehandPoints } from "./stickerPaintbrushGeometry";

/** Three smoothing passes only depend on three neighbors on either side. Freeze
 * the completed prefix and recompute the small tail, with the same result as a
 * full smoothing pass. Source points are append-only during an ordinary brush. */
export const createBrushSmoother = () => {
    let previous: readonly StickerPoint[] = [];
    let result: StickerPoint[] = [];
    let strength = -1;
    return (input: readonly StickerPoint[], smoothing: number) => {
        const nextStrength = freehandSmoothing(smoothing);
        const extendsPrevious = strength === nextStrength && input.length >= previous.length
            && input[0] === previous[0] && input[previous.length - 1] === previous.at(-1);
        if (extendsPrevious && input.length === previous.length) return result;
        const start = extendsPrevious ? Math.max(0, previous.length - 3) : 0;
        const contextStart = Math.max(0, start - 3);
        const tail = smoothFreehandPoints(input.slice(contextStart), nextStrength, true);
        result = [...result.slice(0, start), ...tail.slice(start - contextStart)];
        previous = input;
        strength = nextStrength;
        return result;
    };
};
