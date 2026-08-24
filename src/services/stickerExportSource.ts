/** Graph-aware source selection for direct and composed sticker exports. */
import { graphStore } from "../store/graphStore";
import type { Link, Unit } from "../types/unit";
import { resolveUnitImageFromGraph } from "./graphImageResolution";
import type { ArtCapability } from "./protocol";
import { requiresBakedStickerSyncImage } from "./syncedImagePayload";

export const resolveStickerCompositeBaseImageSrc = (input: {
    unit: Unit;
    units: readonly Unit[];
    links: readonly Link[];
    capabilities?: readonly ArtCapability[];
}) => {
    const displaySrc = resolveUnitImageFromGraph({
        units: input.units,
        links: input.links,
        unitId: input.unit.id,
        capabilities: input.capabilities,
    });

    if (input.unit.data.rasterizedAnnotationLayerSrc) {
        return input.unit.data.src || displaySrc || input.unit.data.previewSrc;
    }

    return displaySrc || input.unit.data.previewSrc || input.unit.data.src;
};

export const resolveDirectStickerExportImageSrc = (input: {
    unit: Unit;
    units: readonly Unit[];
    links: readonly Link[];
    capabilities?: readonly ArtCapability[];
}) => {
    if (input.unit.type !== "sticker" || requiresBakedStickerSyncImage(input.unit)) {
        return undefined;
    }

    const source = resolveStickerCompositeBaseImageSrc(input);
    return source?.startsWith("data:image/") ? source : undefined;
};

export const resolveRuntimeStickerCompositeBaseImageSrc = (unit: Unit) =>
    resolveStickerCompositeBaseImageSrc({
        unit,
        units: graphStore.units,
        links: graphStore.links,
        capabilities: graphStore.capabilities,
    });

export const resolveRuntimeDirectStickerExportImageSrc = (unit: Unit) =>
    resolveDirectStickerExportImageSrc({
        unit,
        units: graphStore.units,
        links: graphStore.links,
        capabilities: graphStore.capabilities,
    });
