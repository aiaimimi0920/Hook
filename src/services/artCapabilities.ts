import type { ArtCapability, ArtCapabilityMetadata } from "./protocol";

const capabilityMetadata = (
    capability: Pick<ArtCapability, "capabilities" | "metadata"> | undefined,
): ArtCapabilityMetadata | undefined =>
    capability?.metadata?.capabilities || capability?.capabilities;

/**
 * Returns whether an Art advertises a local shader/live preview.
 *
 * The legacy execution enum is deliberately checked only as a protocol
 * compatibility fallback. New plugin Arts should advertise
 * metadata.capabilities.preview = "shader".
 */
export const supportsShaderPreview = (
    capability: Pick<ArtCapability, "execution_type" | "capabilities" | "metadata"> | undefined,
): boolean => {
    if (!capability) return false;
    if (capability.execution_type === "shader") return true;

    const metadata = capabilityMetadata(capability);
    return metadata?.preview === "shader" || metadata?.shader === true;
};
