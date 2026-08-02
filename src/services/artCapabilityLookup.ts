import type { ArtCapability } from "./protocol";

export const matchesArtCapabilityId = (
    capability: Pick<ArtCapability, "id" | "legacyId" | "qualifiedId">,
    id: string | null | undefined,
) => !!id && (
    capability.id === id ||
    capability.legacyId === id ||
    capability.qualifiedId === id
);

export const findArtCapability = (
    capabilities: readonly ArtCapability[],
    id: string | null | undefined,
) => capabilities.find((capability) => matchesArtCapabilityId(capability, id));
