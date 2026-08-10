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

export const findArtCapabilityAfterRefresh = async (
    id: string,
    getCapabilities: () => readonly ArtCapability[],
    refreshCapabilities: () => Promise<void>,
): Promise<ArtCapability | undefined> => {
    const loaded = findArtCapability(getCapabilities(), id);
    if (loaded) return loaded;

    await refreshCapabilities();
    return findArtCapability(getCapabilities(), id);
};
