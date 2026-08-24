import { Component, Show, Suspense, lazy, untrack } from "solid-js";
import { loomHook } from "../services/client";
import type { SurfaceSnapshot } from "../services/surfaceProtocol";
import { blurActiveEditableOutside } from "../services/editableFocus";
import { surfaceResourceStore } from "../store/surfaceResourceStore";
import type { SurfaceViewState } from "../store/surfaceStore";
import { graphStore } from "../store/graphStore";
import type { Unit } from "../types/unit";
import { DeclarativeSurface } from "./DeclarativeSurface";

// Optional runtimes are loaded only when a unit needs them. This keeps WebGL and
// sandbox-host code out of the initial desktop chunk without changing their API.
const JavaScriptSurface = lazy(() => import("./JavaScriptSurface").then((module) => ({
    default: module.JavaScriptSurface,
})));
const ShaderPreview = lazy(() => import("./ShaderPreview").then((module) => ({
    default: module.ShaderPreview,
})));

interface SurfacePresentation {
    left: number;
    top: number;
    logicalWidth: number;
    logicalHeight: number;
    scale: number;
}

interface ImageViewport {
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
}

interface UnitSurfaceContentProps {
    unit: Unit;
    unitElement?: HTMLDivElement;
    surface?: SurfaceViewState;
    effectiveSurfaceSnapshot?: SurfaceSnapshot;
    surfacePresentation?: SurfacePresentation;
    isMinified: boolean;
    isShaderArt: boolean;
    artId?: string;
    minifiedViewport: ImageViewport;
    effectiveParams: Record<string, unknown>;
    holdFallbackPreview: boolean;
    inputImageSrc?: string;
    referenceImageSrc?: string;
    requiresReference: boolean;
    resolveUnitImage?: (unitId: string) => string | undefined;
    allowContainerMouseDown: boolean;
    onActivate: () => void | Promise<void>;
    onMouseDown: (event: MouseEvent) => void;
    onIntrinsicSizeChange: (size: { w: number; h: number }) => void;
    onRendered: (dataUrl: string) => void;
}

const surfacePresentationStyle = (presentation?: SurfacePresentation) => {
    if (!presentation) {
        return {
            position: "absolute" as const,
            inset: "0",
            width: "100%",
            height: "100%",
        };
    }
    return {
        position: "absolute" as const,
        left: `${presentation.left}px`,
        top: `${presentation.top}px`,
        width: `${presentation.logicalWidth}px`,
        height: `${presentation.logicalHeight}px`,
        transform: `scale(${presentation.scale})`,
        "transform-origin": "top left",
    };
};

/** Renders Art surface runtimes and the mutually exclusive shader preview. */
export const UnitSurfaceContent: Component<UnitSurfaceContentProps> = (props) => {
    const dispatchSurfaceEvent = (event: Parameters<typeof loomHook.dispatchSurfaceEvent>[0]) => {
        const unitId = props.unit.id;
        const surfaceGeneration = props.surface?.generation;
        void loomHook.dispatchSurfaceEvent(event).catch((error) => {
            const isCurrentSurface = untrack(() =>
                props.unit.id === unitId &&
                props.surface?.generation === surfaceGeneration &&
                graphStore.units.some((candidate) => candidate.id === unitId));
            if (!isCurrentSurface) return;
            graphStore.actions.updateUnitData(unitId, {
                nodeStatus: "error",
                errorMessage: error instanceof Error ? error.message : "Surface event dispatch failed",
            });
        });
    };

    return (
        <>
            <Show when={props.surface} keyed>
                {(surface) => (
                    <div
                        class="art-surface-presentation"
                        style={surfacePresentationStyle(props.surfacePresentation)}
                    >
                        <Show
                            when={(surface.snapshot.runtime ?? "declarative") === "javascript"}
                            fallback={(
                                <DeclarativeSurface
                                    unitId={props.unit.id}
                                    snapshot={props.effectiveSurfaceSnapshot ?? surface.snapshot}
                                    generation={surface.generation}
                                    interactive={!props.isMinified}
                                    onActivate={props.onActivate}
                                    resolveResource={surfaceResourceStore.actions.resolve}
                                    onEvent={dispatchSurfaceEvent}
                                />
                            )}
                        >
                            <Suspense fallback={(
                                <DeclarativeSurface
                                    unitId={props.unit.id}
                                    snapshot={props.effectiveSurfaceSnapshot ?? surface.snapshot}
                                    generation={surface.generation}
                                    interactive={!props.isMinified}
                                    onActivate={props.onActivate}
                                    resolveResource={surfaceResourceStore.actions.resolve}
                                    onEvent={dispatchSurfaceEvent}
                                />
                            )}>
                                <JavaScriptSurface
                                    unitId={props.unit.id}
                                    snapshot={props.effectiveSurfaceSnapshot ?? surface.snapshot}
                                    generation={surface.generation}
                                    lifecycle={surface.lifecycle}
                                    interactive={!props.isMinified}
                                    displayScale={props.surfacePresentation?.scale ?? 1}
                                    resolveResource={surfaceResourceStore.actions.resolve}
                                    onActivate={props.onActivate}
                                    onDragStart={(event) => {
                                        blurActiveEditableOutside(props.unitElement, props.unit.id);
                                        if (props.allowContainerMouseDown) props.onMouseDown(event);
                                    }}
                                    onEvent={dispatchSurfaceEvent}
                                />
                            </Suspense>
                        </Show>
                    </div>
                )}
            </Show>

            <Show when={!props.surface && props.isShaderArt && props.artId}>
                <div style={props.isMinified
                    ? {
                          position: "absolute",
                          width: `${props.minifiedViewport.width}px`,
                          height: `${props.minifiedViewport.height}px`,
                          left: `-${props.minifiedViewport.offsetX}px`,
                          top: `-${props.minifiedViewport.offsetY}px`,
                          "pointer-events": "auto",
                      }
                    : {
                          position: "absolute",
                          left: "0",
                          top: "0",
                          width: "100%",
                          height: "100%",
                          "pointer-events": "auto",
                      }}
                >
                    <Suspense>
                        <ShaderPreview
                            unitId={props.unit.id}
                            artId={props.artId!}
                            params={props.effectiveParams}
                            holdFallbackPreview={props.holdFallbackPreview}
                            fallbackPreviewSrc={props.unit.data.previewSrc || props.unit.data.src}
                            inputImageSrc={props.inputImageSrc}
                            referenceImageSrc={props.referenceImageSrc}
                            requiresReference={props.requiresReference}
                            width={props.isMinified ? props.minifiedViewport.width : props.unit.w}
                            height={props.isMinified ? props.minifiedViewport.height : props.unit.h}
                            opacity={1}
                            onIntrinsicSizeChange={props.onIntrinsicSizeChange}
                            resolveUnitImage={props.resolveUnitImage}
                            onRendered={props.onRendered}
                        />
                    </Suspense>
                </div>
            </Show>
        </>
    );
};
