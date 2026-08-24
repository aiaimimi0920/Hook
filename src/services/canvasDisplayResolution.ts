/** Canvas-specific preview, upstream and source precedence. */
import { DISABLED_PREFIX } from "../constants";
import type { Link, Unit } from "../types/unit";
import { resolveConnectedUnitImageForPort } from "./graphTraversalResolution";

/**
 * Art nodes own their generated preview, while an untouched sticker is a
 * transparent image relay and resolves its connected source before any cached
 * local preview. A locally edited sticker keeps its own preview priority.
 */
export const resolveCanvasDisplayImage = (input: {
    units: readonly Unit[];
    links: readonly Link[];
    unitId: string;
    visited?: Set<string>;
}): string | undefined => {
    const visited = input.visited ?? new Set<string>();
    if (visited.has(input.unitId)) return undefined;
    visited.add(input.unitId);

    const unit = input.units.find((item) => item.id === input.unitId);
    if (!unit) return undefined;

    const link = input.links.find(
        (candidate) =>
            candidate.toUnitId === input.unitId &&
            (candidate.toPortId === "image" ||
                candidate.toPortId === "input_image" ||
                candidate.toPortId === "input"),
    );

    const stickerInputEnabled =
        unit.type !== "sticker" || unit.params?.image !== DISABLED_PREFIX;
    const isTransparentStickerRelay =
        unit.type === "sticker" &&
        stickerInputEnabled &&
        unit.data.stickerEditPropagation?.acceptUpstream !== false &&
        !unit.data.stickerEditPropagation?.locallyEdited;

    const connectedOutput = () =>
        link
            ? resolveConnectedUnitImageForPort({
                  units: input.units,
                  links: input.links,
                  unitId: unit.id,
                  portId: link.toPortId,
                  visited,
              })
            : undefined;

    if (isTransparentStickerRelay && link) {
        const upstream = connectedOutput();
        if (upstream) return upstream;
    }

    if (unit.data.previewSrc) {
        return unit.data.previewSrc;
    }

    if (!isTransparentStickerRelay && stickerInputEnabled && link) {
        const upstream = connectedOutput();
        if (upstream) return upstream;
    }

    return unit.data.src;
};
