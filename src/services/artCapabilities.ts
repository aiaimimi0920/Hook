import type { ArtCapability, ArtCapabilityMetadata } from "./protocol";

const capabilityMetadata = (
    capability: Pick<ArtCapability, "capabilities" | "metadata"> | undefined,
): ArtCapabilityMetadata | undefined =>
    capability?.metadata?.capabilities || capability?.capabilities;

/**
 * Returns whether an Art advertises a local shader/live preview.
 *
 * Installed Arts advertise this behavior through package metadata. Framework
 * ids describe execution ownership and must not be overloaded as UI behavior.
 */
export const supportsShaderPreview = (
    capability: Pick<ArtCapability, "capabilities" | "metadata"> | undefined,
): boolean => {
    if (!capability) return false;
    const metadata = capabilityMetadata(capability);
    return metadata?.preview === "shader" || metadata?.shader === true;
};
