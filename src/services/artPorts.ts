import type { ArtCapability, ArtParam } from "./protocol";

export type ArtInputPort = NonNullable<ArtCapability["inputs"]>[number];

const lowerString = (value: unknown): string =>
    typeof value === "string" ? value.toLowerCase() : "";

const getInputMeta = (input: ArtInputPort, key: string): unknown => {
    // ArtInputPort may have extra metadata fields beyond the typed interface
    const record = input as Record<string, unknown>;
    return record[key];
};

const isImageLikeInput = (input: ArtInputPort): boolean => {
    const type = lowerString(input.type);
    const executionType = lowerString(getInputMeta(input, "execution_type"));
    const dataType = lowerString(getInputMeta(input, "data_type"));
    const name = lowerString(input.name);

    return (
        type.includes("image") ||
        executionType.includes("image") ||
        dataType.includes("image") ||
        ["image", "input_image", "source_image", "reference_image"].includes(name)
    );
};

const isPrimaryImageInput = (input: ArtInputPort): boolean =>
    ["input", "input_image", "image"].includes(lowerString(input.name));

/**
 * ArtLoom capabilities can expose the same node variables in both `inputs`
 * and `params`. The duplicated scalar values are parameter controls, not
 * visual connection ports. Duplicated image-link params are also handled by
 * their parameter row target, otherwise nodes like Color Transfer show two
 * equivalent reference-image endpoints.
 */
export const isCapabilityInputPort = (
    input: ArtInputPort,
    params: readonly ArtParam[] = [],
): boolean => {
    const matchingParam = params.find((param) => param.id === input.name);
    if (!matchingParam) return true;

    return isImageLikeInput(input) && isPrimaryImageInput(input);
};

export const getCapabilityInputsForPorts = (
    capability: Pick<ArtCapability, "inputs" | "params"> | undefined,
    fallback: ArtInputPort[] = [],
): ArtInputPort[] => {
    const inputs = capability?.inputs;
    if (!inputs) return fallback;
    return inputs.filter((input) => isCapabilityInputPort(input, capability?.params || []));
};
