import type { Unit } from "../types/unit";
import { isInternalArtControlParam } from "../constants";
import { findArtCapability } from "./artCapabilityLookup";
import type { ArtCapability } from "./protocol";

export const stripNonPersistableArtParams = (
    unit: Pick<Unit, "type" | "artId">,
    capabilities: readonly ArtCapability[],
    params: Record<string, unknown>,
): Record<string, unknown> => {
    if (unit.type !== "art") return params;

    const capability = findArtCapability(capabilities, unit.artId);
    const secretParamIds = new Set(
        capability?.params
            ?.filter((param) => param.secret)
            .map((param) => param.id) || [],
    );
    return Object.fromEntries(
        Object.entries(params).filter(
            ([id]) => !secretParamIds.has(id) && !isInternalArtControlParam(id),
        ),
    );
};
