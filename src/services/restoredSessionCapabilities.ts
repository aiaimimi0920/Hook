import type { ArtCapability } from "./protocol";
import type { SessionSticker, Unit } from "../types/unit";

const loadedCapabilityIds = (capabilities: readonly ArtCapability[]) =>
    new Set(
        capabilities
            .flatMap((capability) => [
                capability.id,
                capability.legacyId,
                capability.qualifiedId,
            ])
            .filter(
                (capabilityId): capabilityId is string =>
                    typeof capabilityId === "string" && capabilityId.length > 0,
            ),
    );

const sessionArtIdsNeedRefresh = (
    artIds: ReadonlySet<string>,
    capabilities: readonly ArtCapability[],
): boolean => {
    if (artIds.size === 0) {
        return false;
    }

    if (capabilities.length === 0) {
        return true;
    }

    const capabilityIds = loadedCapabilityIds(capabilities);
    for (const artId of artIds) {
        if (!capabilityIds.has(artId)) {
            return true;
        }
    }

    return false;
};

const sessionArtIdsFromSnapshot = (
    stickers: readonly Pick<SessionSticker, "type" | "artId">[] | undefined,
) =>
    new Set(
        (stickers || [])
            .filter(
                (
                    sticker,
                ): sticker is Pick<SessionSticker, "type" | "artId"> & { artId: string } =>
                    typeof sticker.artId === "string" && sticker.artId.length > 0,
            )
            .map((sticker) => sticker.artId),
    );

export const restoredSessionNeedsCapabilityRefresh = (
    units: readonly Unit[],
    capabilities: readonly ArtCapability[],
): boolean => {
    const restoredArtIds = new Set(
        units
            .filter(
                (unit): unit is Unit & { artId: string } =>
                    unit.type === "art" && typeof unit.artId === "string" && unit.artId.length > 0,
            )
            .map((unit) => unit.artId),
    );

    return sessionArtIdsNeedRefresh(restoredArtIds, capabilities);
};

export const sessionSnapshotNeedsCapabilityRefresh = (
    stickers: readonly Pick<SessionSticker, "type" | "artId">[] | undefined,
    capabilities: readonly ArtCapability[],
): boolean => sessionArtIdsNeedRefresh(sessionArtIdsFromSnapshot(stickers), capabilities);
