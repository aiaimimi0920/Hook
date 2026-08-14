import type { Unit } from "../types/unit";
import { findArtCapability } from "./artCapabilityLookup";
import type { ArtCapability } from "./protocol";

export const stripSecretArtParams = (
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
    if (secretParamIds.size === 0) return params;

    return Object.fromEntries(
        Object.entries(params).filter(([id]) => !secretParamIds.has(id)),
    );
};
