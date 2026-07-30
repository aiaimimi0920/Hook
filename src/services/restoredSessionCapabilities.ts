import type { ArtCapability } from "./protocol";
import type { Unit } from "../types/unit";

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

    if (restoredArtIds.size === 0) {
        return false;
    }

    if (capabilities.length === 0) {
        return true;
    }

    const loadedCapabilityIds = new Set(
        capabilities
            .map((capability) => capability.id)
            .filter((capabilityId): capabilityId is string => typeof capabilityId === "string" && capabilityId.length > 0),
    );

    for (const artId of restoredArtIds) {
        if (!loadedCapabilityIds.has(artId)) {
            return true;
        }
    }

    return false;
};
