import type { ArtCapability, ArtCapabilityMetadata } from "./protocol";
import type { SurfacePackageManifest } from "./surfaceProtocol";

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

export const requiresFormalExecutionAfterPreview = (
    capability: Pick<
        ArtCapability,
        "capabilities" | "metadata" | "execution" | "execution_type"
    > | undefined,
): boolean => {
    if (capabilityMetadata(capability)?.requiresFormalExecution === true) return true;
    const executionType = capability?.execution_type || capability?.execution?.type;
    return executionType === "workflow";
};

export const surfacePackageManifest = (
    capability: Pick<ArtCapability, "capabilities" | "metadata"> | undefined,
): SurfacePackageManifest | undefined => capabilityMetadata(capability)?.surface;

export const supportsDeclarativeSurface = (
    capability: Pick<ArtCapability, "capabilities" | "metadata"> | undefined,
): boolean => {
    const surface = surfacePackageManifest(capability);
    return !!surface && (
        surface.variants.some((variant) => variant.runtime === "declarative") ||
        typeof surface.fallbackScene === "string"
    );
};

export const supportsSurface = (
    capability: Pick<ArtCapability, "capabilities" | "metadata"> | undefined,
): boolean => {
    const surface = surfacePackageManifest(capability);
    return !!surface && (
        surface.variants.some((variant) =>
            variant.runtime === "declarative" || variant.runtime === "javascript") ||
        typeof surface.fallbackScene === "string"
    );
};

const imageInputPorts = (capability: ArtCapability | undefined) =>
    capability?.inputs?.filter((input) => {
        const type = `${input.type || ""} ${input.execution_type || ""}`.toLowerCase();
        return type.includes("image") || input.widget === "image_link";
    }) || [];

export const shaderInputPortName = (capability: ArtCapability | undefined): string | undefined => {
    const configured = capabilityMetadata(capability)?.shaderInput;
    if (typeof configured === "string" && configured.trim()) return configured.trim();

    const inputs = imageInputPorts(capability);
    return inputs.find((input) => ["input", "input_image", "image"].includes(input.name.toLowerCase()))
        ?.name || inputs[0]?.name;
};

export const shaderReferenceInputPortName = (
    capability: ArtCapability | undefined,
): string | undefined => {
    const configured = capabilityMetadata(capability)?.shaderReferenceInput;
    if (typeof configured === "string" && configured.trim()) return configured.trim();

    const inputs = imageInputPorts(capability);
    const primary = shaderInputPortName(capability);
    return inputs.find((input) => input.name.toLowerCase() === "reference")?.name
        || inputs.find((input) => input.name !== primary)?.name;
};
