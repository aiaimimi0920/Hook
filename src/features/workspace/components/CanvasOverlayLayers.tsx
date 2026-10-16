import type { Component, Setter } from "solid-js";

export interface CanvasOverlayLayerRefs {
    ports?: HTMLDivElement;
    notices?: HTMLDivElement;
}

/** Hosts portal content that must not inherit an individual unit's stacking context. */
export const CanvasOverlayLayers: Component<{
    onLayersChange: Setter<CanvasOverlayLayerRefs>;
}> = (props) => (
    <>
        <div
            id="ports-layer"
            ref={(element) => {
                props.onLayersChange((current) => ({ ...current, ports: element }));
            }}
            class="absolute inset-0 z-[5] pointer-events-none overflow-visible"
        />
        <div
            id="unit-notices-layer"
            ref={(element) => {
                props.onLayersChange((current) => ({ ...current, notices: element }));
            }}
            class="absolute inset-0 z-[2000000] pointer-events-none overflow-visible"
        />
    </>
);
