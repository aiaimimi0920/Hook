import { Accessor, createEffect, createMemo, onCleanup } from "solid-js";
import {
    applySurfaceViewToSnapshot,
    clearSurfaceViewCrop,
    computeSurfaceViewResetFrame,
    computeSurfaceViewWindowPresentation,
    normalizeSurfaceViews,
    resolveSurfaceView,
} from "../services/artSurfaceViews";
import {
    shaderInputPortName,
    shaderReferenceInputPortName,
    supportsShaderPreview,
    supportsSurface,
} from "../services/artCapabilities";
import { loomHook } from "../services/client";
import { resolveConnectedUnitImageForPort, resolveEffectiveNodeParams } from "../services/graphImageResolution";
import type { ArtCapability } from "../services/protocol";
import { surfaceAttachmentRequests } from "../services/surfaceAttachmentRequests";
import { graphStore } from "../store/graphStore";
import { surfaceResourceStore } from "../store/surfaceResourceStore";
import { surfaceStore } from "../store/surfaceStore";
import type { Unit } from "../types/unit";

interface UnitSurfaceControllerOptions {
    unit: Accessor<Unit>;
    capability: Accessor<ArtCapability | undefined>;
    params: Accessor<Record<string, unknown>>;
    resolveUnitImage: Accessor<((unitId: string) => string | undefined) | undefined>;
    onResize: (nextFrame: Pick<Unit, "x" | "y" | "w" | "h">) => void;
}

/** Owns Art surface attachment, view selection, and shader input resolution. */
export const createUnitSurfaceController = (options: UnitSurfaceControllerOptions) => {
    let disposed = false;
    const isArt = () => options.unit().type === "art";
    const isShaderArt = () => isArt() && supportsShaderPreview(options.capability());
    const surfaceState = () => isArt() ? surfaceStore.byUnit[options.unit().id] : undefined;
    const hasDeclarativeSurface = () => !!surfaceState();
    const surfaceManifest = () => options.capability()?.metadata?.capabilities?.surface;
    const surfaceViews = createMemo(() => normalizeSurfaceViews(surfaceManifest()));
    const selectedSurfaceView = createMemo(() => resolveSurfaceView(
        surfaceManifest(),
        options.unit().data.surfaceViewId ?? surfaceState()?.snapshot.viewId,
    ));
    const effectiveSurfaceSnapshot = () => {
        const snapshot = surfaceState()?.snapshot;
        return snapshot ? applySurfaceViewToSnapshot(snapshot, selectedSurfaceView()) : undefined;
    };
    const surfacePresentation = createMemo(() => {
        const unit = options.unit();
        return computeSurfaceViewWindowPresentation(unit, selectedSurfaceView(), {
            minified: unit.data.minified,
            savedRect: unit.data.savedRect,
            cropOffset: unit.data.cropOffset,
            imageEditState: unit.data.imageEditState,
        });
    });
    const selectSurfaceView = (viewId: string) => {
        const view = surfaceViews().find((candidate) => candidate.id === viewId);
        const currentUnit = options.unit();
        if (!view || currentUnit.data.surfaceViewId === view.id) return;
        graphStore.actions.updateUnitData(currentUnit.id, {
            surfaceViewId: view.id,
            imageEditState: clearSurfaceViewCrop(currentUnit.data.imageEditState),
            minified: false,
            savedRect: undefined,
            cropOffset: undefined,
        });
        options.onResize(computeSurfaceViewResetFrame(currentUnit, view));
    };

    createEffect(() => {
        const view = selectedSurfaceView();
        const unit = options.unit();
        if (view && unit.data.surfaceViewId !== view.id) {
            graphStore.actions.updateUnitData(unit.id, { surfaceViewId: view.id });
        }
    });
    createEffect(() => {
        const unitId = options.unit().id;
        const surface = surfaceState();
        const surfaceGeneration = surface?.generation;
        for (const lease of surface?.snapshot.resourceLeases ?? []) {
            if (lease.transport.kind !== "loom_resource" && lease.transport.kind !== "shared_memory") continue;
            const resourceId = lease.resource.resourceId;
            if (!surfaceResourceStore.actions.begin(resourceId)) continue;
            void loomHook.fetchSurfaceResource(lease).catch((error) => {
                surfaceResourceStore.actions.fail(resourceId);
                const currentSurface = surfaceStore.byUnit[unitId];
                if (
                    disposed ||
                    options.unit().id !== unitId ||
                    currentSurface?.generation !== surfaceGeneration ||
                    !graphStore.units.some((candidate) => candidate.id === unitId)
                ) return;
                graphStore.actions.updateUnitData(unitId, {
                    nodeStatus: "error",
                    errorMessage: error instanceof Error ? error.message : "Surface resource fetch failed",
                });
            });
        }
    });
    createEffect(() => {
        const unit = options.unit();
        const unitId = unit.id;
        const artId = unit.artId;
        if (
            !artId ||
            !supportsSurface(options.capability()) ||
            hasDeclarativeSurface() ||
            !surfaceAttachmentRequests.begin(unitId)
        ) return;
        void loomHook.attachSurface(artId, unitId).catch((error) => {
            const currentUnit = options.unit();
            if (
                disposed ||
                currentUnit.id !== unitId ||
                currentUnit.artId !== artId ||
                hasDeclarativeSurface() ||
                !supportsSurface(options.capability()) ||
                !graphStore.units.some((candidate) => candidate.id === unitId)
            ) return;
            surfaceAttachmentRequests.fail(unitId);
            graphStore.actions.updateUnitData(unitId, {
                nodeStatus: "error",
                errorMessage: error instanceof Error ? error.message : "Surface attach failed",
            });
        });
    });
    onCleanup(() => {
        disposed = true;
    });

    const effectiveParams = () => isArt()
        ? resolveEffectiveNodeParams({
              units: graphStore.units,
              links: graphStore.links,
              capabilities: graphStore.capabilities,
              unitId: options.unit().id,
              manualParams: options.params(),
          })
        : options.params();
    const connectedImageForPort = (portName: string) => resolveConnectedUnitImageForPort({
        units: graphStore.units,
        links: graphStore.links,
        capabilities: graphStore.capabilities,
        unitId: options.unit().id,
        portId: portName,
    });
    const shaderInputSrc = () => {
        const configuredPort = shaderInputPortName(options.capability());
        return (configuredPort ? connectedImageForPort(configuredPort) : undefined)
            || connectedImageForPort("input")
            || connectedImageForPort("input_image")
            || connectedImageForPort("image")
            || options.unit().data.src
            || "";
    };
    const shaderReferenceSrc = () => {
        const configuredPort = shaderReferenceInputPortName(options.capability());
        const configured = configuredPort ? connectedImageForPort(configuredPort) : undefined;
        if (configured) return configured;
        const connected = connectedImageForPort("reference");
        if (connected) return connected;
        const reference = options.params().reference;
        if (typeof reference !== "string" || reference.length === 0) return undefined;
        return options.resolveUnitImage()?.(reference) || reference;
    };
    const requiresReference = () =>
        !!shaderReferenceInputPortName(options.capability())
        || !!options.capability()?.params?.some((param) => param.widget === "image_link" || param.id === "reference")
        || !!options.capability()?.inputs?.some((input) => input.name === "reference");

    return {
        artErrorMessage: () => options.unit().data.errorMessage || "Art execution failed",
        artId: () => options.unit().artId,
        effectiveParams,
        effectiveSurfaceSnapshot,
        hasDeclarativeSurface,
        holdRestoredShaderPreview: () => !!options.unit().data.restoredPreviewLocked
            && !!(options.unit().data.previewSrc || options.unit().data.src),
        isShaderArt,
        requiresReference,
        selectSurfaceView,
        selectedSurfaceView,
        shaderInputSrc,
        shaderReferenceSrc,
        surfacePresentation,
        surfaceState,
        surfaceViews,
    };
};
