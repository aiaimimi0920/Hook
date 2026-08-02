// Session-load mapping: raw persisted sticker -> live `Unit`.
//
// This is the read counterpart to `mapUnitToSessionSticker` in
// sessionStickerPayload.ts. It was extracted verbatim from syncService.ts so
// the many load-bearing defaults it applies (opacity fallbacks, minified
// default, preview-src dedup, art-vs-sticker inference, port synthesis) can be
// characterized by tests instead of living untyped and untested inline.
//
// The only external coupling — the art capability list — is injected rather
// than read from the store, keeping this a pure function.

import type { Unit, SessionSticker } from "../types/unit";
import type { ArtCapability } from "./protocol";
import { getCapabilityInputsForPorts } from "./artPorts";
import { deriveUnitExecutionConfig } from "./nodeExecutionConfig";

export interface SessionStickerMappingDeps {
    /** Art capabilities used to resolve node ports and execution defaults. */
    capabilities: readonly ArtCapability[];
}

const buildUnitPorts = (
    unitType: "sticker" | "art",
    artId: string | undefined,
    capabilities: readonly ArtCapability[],
) => {
    if (unitType === "sticker") {
        return {
            inputs: [{ id: "image", type: "image", direction: "input", label: "Image" }] as Unit["inputs"],
            outputs: [{ id: "output_image", type: "image", direction: "output", label: "Image" }] as Unit["outputs"],
        };
    }

    const capability = capabilities.find((cap) => cap.id === artId);
    const inputs = getCapabilityInputsForPorts(capability, [{ name: "input_image", label: "Input", type: "image" }]).map((port) => ({
        id: port.name,
        label: port.label,
        type: (port.type as "image" | "text" | "any") || "any",
        direction: "input" as const,
    }));
    const outputs = (capability?.outputs || [{ name: "output_image", label: "Image", type: "image" }]).map((port) => ({
        id: port.name,
        label: port.label,
        type: (port.type as "image" | "text" | "any") || "any",
        direction: "output" as const,
    }));

    return { inputs, outputs };
};

export const mapSessionStickerToUnit = (
    sticker: SessionSticker,
    deps: SessionStickerMappingDeps,
): Unit => {
    const unitType: "sticker" | "art" = sticker.type === "art" || sticker.artId ? "art" : "sticker";
    const { inputs, outputs } = buildUnitPorts(unitType, sticker.artId ?? undefined, deps.capabilities);
    const capability = deps.capabilities.find((cap) => cap.id === sticker.artId);
    const executionConfig = deriveUnitExecutionConfig({
        capability,
        explicitConfig: sticker.executionConfig,
    });

    return {
        id: sticker.id,
        type: unitType,
        artId: sticker.artId || undefined,
        x: sticker.x,
        y: sticker.y,
        w: sticker.w,
        h: sticker.h,
        params: (sticker.params as Record<string, any>) || {},
        inputs,
        outputs,
        data: {
            // Original code ran under `any` and assigned `sticker.src` directly;
            // with a typed boundary a persisted `null` normalizes to `undefined`
            // here. Empty string "" (the save side's "missing src" sentinel) is
            // preserved, and every downstream `src || ...` reader is unaffected.
            src: sticker.src ?? undefined,
            minified: sticker.minified ?? false,
            savedRect: sticker.savedRect || undefined,
            cropOffset: sticker.cropOffset || undefined,
            opacityNormal: sticker.opacityNormal ?? 1,
            opacityMini: sticker.opacityMini ?? 0.9,
            previewSrc: sticker.previewSrc && sticker.previewSrc !== sticker.src ? sticker.previewSrc : undefined,
            restoredPreviewLocked:
                unitType === "art" &&
                !!sticker.previewSrc &&
                sticker.previewSrc !== sticker.src,
            filePath: sticker.filePath || undefined,
            rasterizedAnnotationLayerSrc: sticker.rasterizedAnnotationLayerSrc || undefined,
            outputs: sticker.outputs || undefined,
            originWorkflowId: sticker.originWorkflowId || undefined,
            originNodeId: sticker.originNodeId || undefined,
            executionConfig,
            annotationState: sticker.annotationState || undefined,
            imageEditState: sticker.imageEditState || undefined,
            stickerEditPropagation: sticker.stickerEditPropagation || undefined,
            groupId: sticker.groupId || undefined,
            captureMeta: sticker.captureMeta || undefined,
        },
    };
};

// Top-level keys the save/load pair reads and writes. The `satisfies` check
// keeps this set locked to `SessionSticker` at compile time: adding or removing
// a field on that interface fails the build here until this list is updated.
const KNOWN_SESSION_STICKER_KEYS = {
    id: true,
    type: true,
    artId: true,
    x: true,
    y: true,
    w: true,
    h: true,
    src: true,
    previewSrc: true,
    minified: true,
    savedRect: true,
    cropOffset: true,
    opacityNormal: true,
    opacityMini: true,
    params: true,
    filePath: true,
    rasterizedAnnotationLayerSrc: true,
    outputs: true,
    originWorkflowId: true,
    originNodeId: true,
    executionConfig: true,
    annotationState: true,
    imageEditState: true,
    stickerEditPropagation: true,
    groupId: true,
    captureMeta: true,
} satisfies Record<keyof SessionSticker, true>;

/**
 * Returns the persisted top-level keys the loader does not recognize. A
 * non-empty result signals the saved sticker schema has drifted (e.g. a renamed
 * backend field), which means that data is being silently dropped on load.
 *
 * Purely diagnostic: the caller logs this and never rejects the session, so a
 * drifted or foreign session still loads with whatever the mapper understands.
 */
export const detectUnknownSessionStickerKeys = (raw: Record<string, unknown>): string[] =>
    Object.keys(raw).filter((key) => !(key in KNOWN_SESSION_STICKER_KEYS));
